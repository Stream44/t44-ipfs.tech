import { EventEmitter } from 'events';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as dagCBOR from '@ipld/dag-cbor';
import * as dagJSON from '@ipld/dag-json';
import * as dagPB from '@ipld/dag-pb';
import * as raw from 'multiformats/codecs/raw';
import { importer } from 'ipfs-unixfs-importer';
import { exporter } from 'ipfs-unixfs-exporter';
import { CarWriter, CarReader } from '@ipld/car';
import { $ } from 'bun';
import { mkdir, access, exists } from 'fs/promises';
import path from 'node:path';
import { privateKeyFromPem } from './utils';

// Re-export utility functions
export { privateKeyFromPem, CID };

// IPFS HTTP API configuration
const IPFS_API_URL = process.env.IPFS_API_URL || 'http://localhost:5001';

/**
 * Supported IPLD codecs
 */
export type SupportedCodec = 'dag-cbor' | 'dag-json' | 'dag-pb' | 'raw';

/**
 * Codec name to code mapping
 */
const CODEC_MAP: Record<SupportedCodec, number> = {
    'dag-cbor': dagCBOR.code,
    'dag-json': dagJSON.code,
    'dag-pb': dagPB.code,
    'raw': raw.code,
};

/**
 * Codec implementations
 */
const CODECS: Record<SupportedCodec, { encode: (data: any) => Uint8Array; decode: (data: Uint8Array) => any }> = {
    'dag-cbor': dagCBOR,
    'dag-json': dagJSON,
    'dag-pb': dagPB,
    'raw': raw,
};


/**
 * File input format for upload
 */
export interface FileInput {
    path: string;
    content: string | Uint8Array;
}

/**
 * Pre-processed UnixFS file node with CID already computed
 */
export interface UnixFSFileNode {
    cid: string;
    path: string;
    block: Uint8Array;
}

/**
 * File output format from download
 */
export interface FileOutput {
    path: string;
    content: string | Uint8Array;
}

/**
 * Upload options
 */
export interface UploadOptions {
    pin?: boolean;
    mfsPath?: string;
}

/**
 * Client configuration options
 */
export interface ClientOptions {
    connection: IPFSConnection;
    verbose?: boolean;
}

/**
 * Server configuration options
 */
export interface ServerOptions {
    connection: IPFSConnection;
    ipfsRepoPath: string; // Required IPFS repo path for key export/import operations
    verbose?: boolean;
}



/**
 * IPFS Connection configuration
 * Provides a convenient way to configure IPFS RPC and Gateway URLs
 */
export class IPFSConnection {
    public rpcPort: number | null;
    public rpcUrl: string | null;
    public gatewayUrl: string;
    public gatewayPort: number;
    public gatewayTrustlessHost: string | null;

    constructor({
        protocol = 'http',
        hostname = '127.0.0.1',
        rpcPort = 5001,
        gatewayPort = 8080,
        gatewayTrustlessHost = null
    }: {
        protocol?: string;
        hostname?: string;
        rpcPort?: number;
        gatewayPort?: number;
        gatewayTrustlessHost?: string | null;
    } = {}) {
        this.rpcPort = rpcPort;
        this.gatewayPort = gatewayPort;
        this.gatewayTrustlessHost = gatewayTrustlessHost;

        // Normalize protocol (ensure it ends with :)
        const normalizedProtocol = protocol.endsWith(':') ? protocol : `${protocol}:`;

        // Build URLs
        this.rpcUrl = rpcPort ? `${normalizedProtocol}//${hostname}:${rpcPort}` : null;
        this.gatewayUrl = `${normalizedProtocol}//${hostname}:${gatewayPort}`;
    }

    toJSON() {
        const json: any = {
            rpcUrl: this.rpcUrl,
            gatewayUrl: this.gatewayUrl,
        };
        if (this.gatewayTrustlessHost !== null) {
            json.gatewayTrustlessHost = this.gatewayTrustlessHost;
        }
        return json;
    }

    static fromJSON(json: any) {
        const connection = Object.create(IPFSConnection.prototype);
        connection.rpcUrl = json.rpcUrl;
        connection.gatewayUrl = json.gatewayUrl;
        connection.gatewayTrustlessHost = json.gatewayTrustlessHost !== undefined ? json.gatewayTrustlessHost : null;

        // Use explicit port values if provided, otherwise extract from URLs
        if (json.rpcPort !== undefined) {
            connection.rpcPort = json.rpcPort;
        } else if (json.rpcUrl) {
            try {
                const rpcUrlObj = new URL(json.rpcUrl);
                connection.rpcPort = rpcUrlObj.port ? parseInt(rpcUrlObj.port) : null;
            } catch {
                connection.rpcPort = null;
            }
        } else {
            connection.rpcPort = null;
        }

        if (json.gatewayPort !== undefined) {
            connection.gatewayPort = json.gatewayPort;
        } else {
            try {
                const gatewayUrlObj = new URL(json.gatewayUrl);
                connection.gatewayPort = gatewayUrlObj.port ? parseInt(gatewayUrlObj.port) : (gatewayUrlObj.protocol === 'https:' ? 443 : 80);
            } catch {
                connection.gatewayPort = 80;
            }
        }

        return connection;
    }

    static fromEnv(name: string) {
        if (!process.env[name]) {
            throw new Error(`Missing environment variable: ${name}`);
        }
        return IPFSConnection.fromJSON(JSON.parse(process.env[name]!));
    }
}


/**
 * Base IPFS Client for core IPFS operations
 * Provides block storage, pinning, and MFS (Mutable File System) functionality
 * No caching - all operations go directly to IPFS
 */
export class IPFSClient extends EventEmitter {

    protected connection: IPFSConnection;
    protected verbose: boolean;
    public hasher = sha256; // Use SHA-256 hasher (widely supported)

    constructor({ connection, verbose = false }: ClientOptions) {
        super();
        this.connection = connection;
        this.verbose = verbose;
    }

    protected debug(...args: any[]) {
        if (this.verbose) {
            console.log('[IPFS]', ...args);
        }
    }

    private getHeaders(): HeadersInit {
        const headers: HeadersInit = {};
        const ipfsGatewayToken = process.env.IPFS_GATEWAY_TOKEN;
        if (ipfsGatewayToken) {
            headers['Authorization'] = `Bearer ${ipfsGatewayToken}`;
            if (this.verbose) {
                const maskedToken = ipfsGatewayToken.length > 8
                    ? `${ipfsGatewayToken.slice(0, 4)}...${ipfsGatewayToken.slice(-4)}`
                    : '****';
                console.log(`[IPFSClient] Using bearer token: ${maskedToken}`);
            }
        } else if (this.verbose) {
            console.log(`[IPFSClient] No IPFS_GATEWAY_TOKEN found in environment`);
        }
        return headers;
    }

    getConnection(): IPFSConnection {
        return this.connection;
    }

    /**
     * Check if IPFS daemon is running
     */
    async isRunning(): Promise<boolean> {
        try {
            const response = await fetch(`${this.connection.rpcUrl}/api/v0/version`, {
                method: 'POST',
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Store a block in the local IPFS node using the block/put API
     */
    async putBlock(cid: CID, block: Uint8Array): Promise<CID> {
        const formData = new FormData();
        formData.append('file', new Blob([block]), 'block');

        const url = `${this.connection.rpcUrl}/api/v0/block/put?allow-big-block=true`;
        const headers = this.getHeaders();
        if (this.verbose) {
            console.log(`[IPFSClient.putBlock] Storing block ${cid.toString()}`);
            console.log(`[IPFSClient.putBlock] URL: ${url}`);
            console.log(`[IPFSClient.putBlock] Headers:`, Object.keys(headers));
        }

        // Use the allow-big-block flag to support blocks larger than 1MB
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to store block in IPFS: ${response.status} - ${errorText}`);
        }

        await response.json();
        return cid;
    }

    /**
     * Retrieve a block from IPFS using the RPC API (works in offline mode)
     * or trustless gateway if configured
     */
    async getBlock(cid: CID): Promise<Uint8Array> {
        // Use trustless gateway if configured
        if (this.connection.gatewayTrustlessHost) {
            return this.getBlockFromTrustlessGateway(cid);
        }

        // Use RPC API's block/get endpoint to match putBlock behavior
        // This works in offline mode, unlike the gateway which requires network access
        const url = `${this.connection.rpcUrl}/api/v0/block/get?arg=${cid.toString()}`;
        const headers = this.getHeaders();
        const maxRetries = 3;
        const retryDelay = 3000; // 3 seconds

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (this.verbose && attempt === 1) {
                console.log(`[IPFSClient.getBlock] Fetching block ${cid.toString()}`);
                console.log(`[IPFSClient.getBlock] URL: ${url}`);
                console.log(`[IPFSClient.getBlock] Headers:`, Object.keys(headers));
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
            });

            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                if (this.verbose) {
                    console.log(`[IPFSClient.getBlock] ✅ Retrieved ${arrayBuffer.byteLength} bytes`);
                }
                return new Uint8Array(arrayBuffer);
            }

            // Don't retry on 404 - block doesn't exist
            if (response.status === 404) {
                const errorText = await response.text();
                console.error(`[IPFSClient.getBlock] ❌ Failed: HTTP ${response.status}`);
                console.error(`[IPFSClient.getBlock] Error body:`, errorText.substring(0, 500));
                throw new Error(`Failed to retrieve block from IPFS: ${response.status} - ${errorText}`);
            }

            // Log error and retry for other status codes
            const errorText = await response.text();
            console.error(`[IPFSClient.getBlock] ❌ Attempt ${attempt}/${maxRetries} failed: HTTP ${response.status}`);

            if (attempt === maxRetries) {
                // Final attempt failed - log full error with URL
                console.error(`[IPFSClient.getBlock] ❌ All ${maxRetries} attempts failed for URL: ${url}`);
                console.error(`[IPFSClient.getBlock] Error body:`, errorText.substring(0, 500));
                throw new Error(`Failed to retrieve block from IPFS: ${response.status} - ${errorText}`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }

        // This should never be reached, but TypeScript needs it
        throw new Error(`Failed to retrieve block from IPFS after ${maxRetries} attempts`);
    }

    /**
     * Retrieve a block from a trustless gateway using the CAR format
     * Implements the IPFS Trustless Gateway spec: https://specs.ipfs.tech/http-gateways/trustless-gateway/
     */
    private async getBlockFromTrustlessGateway(cid: CID): Promise<Uint8Array> {
        const url = `https://${this.connection.gatewayTrustlessHost}/ipfs/${cid.toString()}?format=car&dag-scope=block`;
        const headers = this.getHeaders();


        const response = await fetch(url, {
            method: 'GET',
            headers: {
                ...headers,
                'Accept': 'application/vnd.ipld.car; order=dfs; dups=n',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to retrieve block from trustless gateway: ${response.status} - ${errorText}`);
        }

        const carBytes = new Uint8Array(await response.arrayBuffer());

        if (this.verbose) {
            console.log(`[IPFSClient.getBlockFromTrustlessGateway] Received block: ${carBytes.byteLength} bytes`);
        }

        // Parse the CAR file to extract the block
        const reader = await CarReader.fromBytes(carBytes);

        // Iterate through blocks to find the requested CID
        for await (const { cid: blockCid, bytes } of reader.blocks()) {
            if (this.verbose) {
                console.log(`[IPFSClient.getBlockFromTrustlessGateway] Found block: ${blockCid.toString()}`);
            }
            if (blockCid.equals(cid)) {
                if (this.verbose) {
                    console.log(`[IPFSClient.getBlockFromTrustlessGateway] ✅ Retrieved ${bytes.byteLength} bytes`);
                }
                return bytes;
            }
        }

        throw new Error(`Block ${cid.toString()} not found in response`);
    }

    /**
     * Check if a block exists in the local IPFS node or trustless gateway
     */
    async hasBlock(cid: CID): Promise<boolean> {
        try {
            // Use trustless gateway if configured
            if (this.connection.gatewayTrustlessHost) {
                const url = `https://${this.connection.gatewayTrustlessHost}/ipfs/${cid.toString()}?format=car`;
                const headers = this.getHeaders();
                if (this.verbose) {
                    console.log(`[IPFSClient.hasBlock] Checking block via trustless gateway ${cid.toString()}`);
                    console.log(`[IPFSClient.hasBlock] URL: ${url}`);
                }
                const response = await fetch(url, {
                    method: 'HEAD',
                    headers: {
                        ...headers,
                        'Accept': 'application/vnd.ipld.car',
                    },
                });
                return response.ok;
            }

            const url = `${this.connection.rpcUrl}/api/v0/block/stat?arg=${cid.toString()}`;
            const headers = this.getHeaders();
            if (this.verbose) {
                console.log(`[IPFSClient.hasBlock] Checking block ${cid.toString()}`);
                console.log(`[IPFSClient.hasBlock] URL: ${url}`);
                console.log(`[IPFSClient.hasBlock] Headers:`, Object.keys(headers));
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Store data with a specific codec and return the CID
     * Encodes the data using the specified codec, creates a CID, and stores the block
     * 
     * @param data - The data to store (will be encoded with the specified codec)
     * @param options - Options object with codec property (defaults to 'raw')
     * @returns The CID of the stored block
     */
    async putWithCodec(data: any, { codec = 'raw' as SupportedCodec } = {}): Promise<CID> {
        // Get the codec implementation
        const codecImpl = CODECS[codec];
        if (!codecImpl) {
            throw new Error(`Unsupported codec: ${codec}`);
        }

        // Encode the data
        const bytes = codecImpl.encode(data);

        // Create a hash of the encoded data
        const hash = await this.hasher.digest(bytes);

        // Create a CID with the appropriate codec
        const cid = CID.create(1, CODEC_MAP[codec], hash);

        // Store the block
        await this.putBlock(cid, bytes);

        return cid;
    }

    /**
     * Retrieve and decode data from a CID using its codec
     * Automatically detects the codec from the CID and decodes the data
     * 
     * @param cid - The CID to retrieve
     * @returns The decoded data
     */
    async getWithCodec<T = any>(cid: CID): Promise<T> {
        // Get the block data
        const bytes = await this.getBlock(cid);

        // Determine the codec from the CID
        const codecCode = cid.code;

        // Find the matching codec
        let codecImpl: { decode: (data: Uint8Array) => any } | undefined;
        let codecName: SupportedCodec | undefined;

        for (const [name, code] of Object.entries(CODEC_MAP)) {
            if (code === codecCode) {
                codecName = name as SupportedCodec;
                codecImpl = CODECS[codecName];
                break;
            }
        }

        if (!codecImpl || !codecName) {
            throw new Error(`Unsupported codec code: ${codecCode}`);
        }

        // Decode the data
        return codecImpl.decode(bytes) as T;
    }

    /**
     * Alias for putBlock - required by ipfs-unixfs-importer interface
     */
    async put(cid: CID, block: Uint8Array): Promise<CID> {
        return this.putBlock(cid, block);
    }

    /**
     * Fetch a file from IPFS gateway
     * @param cid - The CID to fetch
     * @param filepath - Optional path within the CID (for directories)
     * @returns Buffer of the file contents
     * @throws Error with response attached if status is not 200
     */
    async fetch(cid: CID | string, filepath?: string): Promise<Uint8Array> {
        const cidString = typeof cid === 'string' ? cid : cid.toString();
        const path = filepath ? `/${filepath}` : '';
        const url = `${this.connection.gatewayUrl}/ipfs/${cidString}${path}`;

        this.debug(`Fetching from gateway: ${url}`);

        const response = await fetch(url, {
            headers: this.getHeaders()
        });

        if (response.status !== 200) {
            const error = new Error(`Failed to fetch from IPFS gateway: ${response.status} ${response.statusText}`);
            (error as any).response = response;
            throw error;
        }

        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    /**
     * Alias for getBlock - required by ipfs-unixfs-exporter interface
     */
    async get(cid: CID): Promise<Uint8Array> {
        return this.getBlock(cid);
    }

    /**
     * Alias for hasBlock - required by storage interface
     */
    async has(cid: CID): Promise<boolean> {
        return this.hasBlock(cid);
    }

    /**
     * Check if IPFS daemon is running
     */
    async isIPFSRunning(): Promise<boolean> {
        try {
            const url = `${this.connection.rpcUrl}/api/v0/version`;
            this.debug(`[isIPFSRunning] Checking IPFS daemon at: ${url}`);
            this.debug(`[isIPFSRunning] Connection object:`, this.connection);

            const response = await fetch(url, {
                method: 'POST',
            });

            this.debug(`[isIPFSRunning] Response status: ${response.status}, ok: ${response.ok}`);
            return response.ok;
        } catch (error) {
            this.debug(`[isIPFSRunning] Error checking IPFS daemon:`, error);
            if (error instanceof Error) {
                this.debug(`[isIPFSRunning] Error message: ${error.message}`);
                this.debug(`[isIPFSRunning] Error stack: ${error.stack}`);
            }
            return false;
        }
    }

    /**
     * Get IPFS version info
     */
    async getIPFSVersion(): Promise<any> {
        const response = await fetch(`${this.connection.rpcUrl}/api/v0/version`, {
            method: 'POST',
        });

        if (!response.ok) {
            throw new Error(`Failed to get IPFS version: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Pin a CID in IPFS
     */
    async pinCid(cid: string): Promise<void> {
        this.debug(`Pinning CID: ${cid}`);

        const response = await fetch(`${this.connection.rpcUrl}/api/v0/pin/add?arg=${cid}`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to pin CID: ${response.status} - ${errorText}`);
        }

        this.debug(`✅ CID pinned successfully: ${cid}`);

        // Emit event for automatic cleanup tracking
        this.emit('cid:pinned', cid);
    }

    /**
     * Unpin a CID from IPFS
     */
    async unpinCid(cid: string, options?: { ignoreMissing?: boolean }): Promise<void> {
        this.debug(`Unpinning CID: ${cid}`);

        const response = await fetch(`${this.connection.rpcUrl}/api/v0/pin/rm?arg=${cid}`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();

            // If ignoreMissing is true and the error indicates the CID is not pinned or invalid, don't throw
            if (options?.ignoreMissing && (
                errorText.includes('not pinned') ||
                errorText.includes('invalid path') ||
                errorText.includes('path does not have enough components')
            )) {
                this.debug(`⏭️  CID not pinned (ignored): ${cid}`);
                return;
            }

            throw new Error(`Failed to unpin CID: ${response.status} - ${errorText}`);
        }

        this.debug(`✅ CID unpinned successfully: ${cid}`);
    }

    /**
     * Check if a CID is pinned
     */
    async isPinned(cid: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.connection.rpcUrl}/api/v0/pin/ls?arg=${cid}`, {
                method: 'POST',
            });

            if (!response.ok) {
                return false;
            }

            const result = await response.json();
            return result.Keys && Object.keys(result.Keys).length > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Copy a pinned CID to MFS (Mutable File System) to make it visible in IPFS Desktop Files tab
     * @param cid - The CID to copy to MFS
     * @param mfsPath - The path in MFS (e.g., '/my-files')
     */
    async copyToMFS(cid: string, mfsPath: string): Promise<void> {
        this.debug(`Copying CID ${cid} to MFS path: ${mfsPath}`);

        // First, ensure the parent directory exists (create if needed)
        const parentPath = mfsPath.substring(0, mfsPath.lastIndexOf('/')) || '/';
        if (parentPath !== '/') {
            try {
                const mkdirResponse = await fetch(`${this.connection.rpcUrl}/api/v0/files/mkdir?arg=${parentPath}&parents=true`, {
                    method: 'POST',
                });
                // Ignore errors if directory already exists
            } catch (error) {
                // Ignore mkdir errors
            }
        }

        // Copy the CID to MFS
        const response = await fetch(`${this.connection.rpcUrl}/api/v0/files/cp?arg=/ipfs/${cid}&arg=${mfsPath}`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to copy to MFS: ${response.status} - ${errorText}`);
        }

        this.debug(`✅ CID copied to MFS successfully: ${mfsPath}`);

        // Emit event for automatic cleanup tracking
        this.emit('mfs:created', mfsPath);
    }

    /**
     * Remove a path from MFS (Mutable File System)
     * @param mfsPath - The path in MFS to remove (e.g., '/my-files')
     * @param options - Options for removal
     * @param options.ignoreMissing - If true, don't throw error if path doesn't exist (default: false)
     */
    async removeFromMFS(mfsPath: string, { ignoreMissing = false }: { ignoreMissing?: boolean } = {}): Promise<void> {
        this.debug(`Removing MFS path: ${mfsPath}`);

        const response = await fetch(`${this.connection.rpcUrl}/api/v0/files/rm?arg=${mfsPath}&recursive=true`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            // Check if error is due to missing file/directory
            if (ignoreMissing && (errorText.includes('file does not exist') || errorText.includes('no link named'))) {
                this.debug(`⚠️  MFS path does not exist (ignored): ${mfsPath}`);
                return;
            }
            throw new Error(`Failed to remove from MFS: ${response.status} - ${errorText}`);
        }

        this.debug(`✅ MFS path removed successfully: ${mfsPath}`);
    }

    /**
     * Check if a path exists in MFS
     * @param mfsPath - The path in MFS to check
     */
    async existsInMFS(mfsPath: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.connection.rpcUrl}/api/v0/files/stat?arg=${mfsPath}`, {
                method: 'POST',
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Publish a CID to IPNS using a key
     * @param cid - The CID to publish
     * @param options - Publish options
     * @param options.key - The key name to use (default: 'self')
     * @param options.lifetime - Time duration that the record will be valid (default: '24h')
     * @param options.ttl - Time duration this record should be cached
     * @param options.allowOffline - Allow publishing in offline mode (default: true for local testing)
     * @returns The IPNS name (hash)
     */
    async publishToIPNS(
        cid: string,
        { key = 'self', lifetime = '24h', ttl, allowOffline = true }: { key?: string; lifetime?: string; ttl?: string; allowOffline?: boolean } = {}
    ): Promise<string> {
        this.debug(`Publishing CID ${cid} to IPNS with key: ${key}`);

        let url = `${this.connection.rpcUrl}/api/v0/name/publish?arg=${cid}&key=${key}&lifetime=${lifetime}`;
        if (ttl) {
            url += `&ttl=${ttl}`;
        }
        if (allowOffline) {
            url += `&allow-offline=true`;
        }

        const response = await fetch(url, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to publish to IPNS: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        this.debug(`✅ Published to IPNS: ${result.Name} -> ${result.Value}`);

        return result.Name;
    }

    /**
     * Resolve an IPNS name to a CID
     * @param name - The IPNS name to resolve
     * @param options - Resolve options
     * @param options.recursive - Resolve until the result is not an IPNS name (default: true)
     * @param options.nocache - Do not use cached entries (default: false)
     * @returns The resolved CID path
     */
    async resolveIPNS(
        name: string,
        { recursive = true, nocache = false }: { recursive?: boolean; nocache?: boolean } = {}
    ): Promise<string> {
        this.debug(`Resolving IPNS name: ${name}`);

        let url = `${this.connection.rpcUrl}/api/v0/name/resolve?arg=${name}&recursive=${recursive}&nocache=${nocache}`;

        const response = await fetch(url, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to resolve IPNS name: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        this.debug(`✅ Resolved IPNS: ${name} -> ${result.Path}`);

        // Return the path (e.g., "/ipfs/QmXXX...")
        return result.Path;
    }

    /**
     * Generate a new IPNS key using the IPFS API
     * @param name - The name for the new key
     * @param options - Key generation options
     * @param options.type - Type of key to generate (default: 'Ed25519')
     * @returns Key information including name, id, and optionally raw private key bytes
     */
    async generateIPNSKey(
        name: string,
        { type = 'Ed25519' }: { type?: 'Ed25519' | 'RSA' } = {}
    ): Promise<{ Name: string; Id: string; privateKey?: Uint8Array }> {
        this.debug(`Generating IPNS key: ${name} (${type})`);

        // Use IPFS API to generate the key
        const keyType = type === 'Ed25519' ? 'ed25519' : 'rsa';
        const response = await fetch(`${this.connection.rpcUrl}/api/v0/key/gen?arg=${encodeURIComponent(name)}&type=${keyType}`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to generate IPNS key: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        this.debug(`✅ Generated IPNS key: ${result.Name} (${result.Id})`);

        // Note: The IPFS API doesn't return the private key bytes
        // To get the private key for export, we would need to export it separately
        return {
            Name: result.Name,
            Id: result.Id
        };
    }


    /**
     * List all IPNS keys
     * @returns Array of keys with Name and Id
     */
    async listIPNSKeys(): Promise<Array<{ Name: string; Id: string }>> {
        this.debug('Listing IPNS keys...');

        const response = await fetch(`${this.connection.rpcUrl}/api/v0/key/list`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to list IPNS keys: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        this.debug(`✅ Found ${result.Keys?.length || 0} IPNS keys`);

        return result.Keys || [];
    }

    /**
     * Remove an IPNS key
     * @param name - The name of the key to remove
     * @returns Information about the removed key
     */
    async removeIPNSKey(name: string): Promise<{ Name: string; Id: string }> {
        this.debug(`Removing IPNS key: ${name}`);

        const response = await fetch(`${this.connection.rpcUrl}/api/v0/key/rm?arg=${name}`, {
            method: 'POST',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to remove IPNS key: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        this.debug(`✅ Removed IPNS key: ${result.Keys?.[0]?.Name} (${result.Keys?.[0]?.Id})`);

        return result.Keys[0];
    }

    /**
     * Upload files to IPFS and return the root CID
     * Creates a directory structure based on file paths
     * No caching - always stores directly to IPFS
     * 
     * @param files - Array of files with path and content
     * @param options - Upload options including pin flag and optional MFS path
     * @returns Root CID of the uploaded directory structure
     */
    async importFiles(
        files: FileInput[],
        { pin = false, mfsPath }: UploadOptions = {}
    ): Promise<string> {
        this.debug(`Uploading ${files.length} files...`);

        // Validate files structure
        for (const file of files) {
            if (!file.path || typeof file.path !== 'string') {
                throw new Error(`Invalid file structure: missing or invalid 'path' property`);
            }
            if (file.content === undefined || file.content === null) {
                throw new Error(`File content is undefined or null for path: ${file.path}`);
            }
            if (typeof file.content !== 'string' && !(file.content instanceof Uint8Array)) {
                throw new Error(`File content must be string or Uint8Array for path: ${file.path}, got: ${typeof file.content}`);
            }
        }

        // Prepare sources for the importer
        const sources = files.map(file => ({
            path: file.path,
            content: (async function* () {
                // Handle both string and Uint8Array content
                if (typeof file.content === 'string') {
                    yield new TextEncoder().encode(file.content);
                } else {
                    yield file.content;
                }
            })()
        }));

        let rootCid: CID | undefined;

        // Import all files using ipfs-unixfs-importer with wrapWithDirectory
        for await (const entry of importer(sources, this, {
            wrapWithDirectory: true,
            cidVersion: 1
        })) {
            this.debug(`Imported: ${entry.path || '(root)'} -> ${entry.cid.toString()}`);
            // The last entry with empty path is the root directory
            if (entry.path === '') {
                rootCid = entry.cid;
            }
        }

        if (!rootCid) {
            throw new Error('Failed to get root CID from import');
        }

        const rootCidString = rootCid.toString();
        this.debug(`✅ Upload complete. Root CID: ${rootCidString}`);

        // Pin if requested
        if (pin) {
            await this.pinCid(rootCidString);
        }

        // Copy to MFS if path specified
        if (mfsPath) {
            await this.copyToMFS(rootCidString, mfsPath);
        }

        return rootCidString;
    }

    /**
     * Download a single file from IPFS using either a CID or MFS path
     * No caching - always fetches directly from IPFS
     * 
     * @param cidOrPath - Either a CID string or MFS path (starting with /)
     * @param filePath - Optional: specific file path within the directory (e.g., 'nested/file.txt')
     * @returns File content as string or Uint8Array (attempts to decode as UTF-8, returns binary if fails)
     */
    async exportFile(cidOrPath: string, filePath?: string): Promise<string | Uint8Array> {
        this.debug(`Downloading file from: ${cidOrPath}${filePath ? `/${filePath}` : ''}`);

        let cid: CID;

        // Check if it's an MFS path (starts with /)
        if (cidOrPath.startsWith('/')) {
            this.debug(`Resolving MFS path: ${cidOrPath}`);

            // Use files/stat to get the CID from MFS path
            const response = await fetch(`${this.connection.rpcUrl}/api/v0/files/stat?arg=${cidOrPath}`, {
                method: 'POST',
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to resolve MFS path: ${response.status} - ${errorText}`);
            }

            const stat = await response.json();
            cid = CID.parse(stat.Hash);
            this.debug(`Resolved MFS path to CID: ${cid.toString()}`);
        } else {
            // It's a CID
            cid = CID.parse(cidOrPath);
        }

        // If filePath is specified, append it to the CID
        const fullPath = filePath ? `${cid.toString()}/${filePath}` : cid.toString();

        // Export the file
        const fileEntry = await exporter(fullPath, this);

        if (fileEntry.type !== 'file' && fileEntry.type !== 'raw') {
            throw new Error(`Path does not point to a file: ${fullPath}`);
        }

        // Read the file content
        const chunks: Uint8Array[] = [];
        for await (const chunk of fileEntry.content()) {
            chunks.push(chunk);
        }

        // Combine all chunks into a single Uint8Array
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        // Try to decode as UTF-8 text, return binary if it fails
        try {
            const decoder = new TextDecoder('utf-8', { fatal: true });
            const content = decoder.decode(combined);
            this.debug(`✅ File downloaded: ${content.length} characters (text)`);
            return content;
        } catch {
            // Not valid UTF-8, return as binary
            this.debug(`✅ File downloaded: ${combined.length} bytes (binary)`);
            return combined;
        }
    }

    /**
     * Download files from IPFS using a root CID
     * Recursively traverses the directory structure
     * No caching - always fetches directly from IPFS
     * 
     * @param rootCid - Root CID of the directory structure
     * @returns Array of files with path and content
     */
    async exportFiles(rootCid: string): Promise<FileOutput[]> {
        this.debug(`Downloading files from CID: ${rootCid}`);

        const files: FileOutput[] = [];

        // Parse the CID
        const cid = CID.parse(rootCid);

        // Export the root directory
        const rootEntry = await exporter(cid, this);

        if (rootEntry.type !== 'directory') {
            throw new Error('Root CID must point to a directory');
        }

        // Recursively traverse and collect files
        const traverseDirectory = async (dirCid: CID, basePath: string = '') => {
            const dirEntry = await exporter(dirCid, this);

            if (dirEntry.type !== 'directory') {
                return;
            }

            for await (const entry of dirEntry.content()) {
                const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;

                if (entry.type === 'directory') {
                    // Recursively traverse subdirectories
                    await traverseDirectory(entry.cid, fullPath);
                } else if (entry.type === 'file' || entry.type === 'raw') {
                    // Read file content
                    const fileEntry = await exporter(entry.cid, this);

                    if (fileEntry.type === 'file' || fileEntry.type === 'raw') {
                        // Collect all chunks
                        const chunks: Uint8Array[] = [];
                        for await (const chunk of fileEntry.content()) {
                            chunks.push(chunk);
                        }

                        // Combine all chunks into a single Uint8Array
                        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                        const combined = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of chunks) {
                            combined.set(chunk, offset);
                            offset += chunk.length;
                        }

                        // Try to decode as UTF-8 text, return binary if it fails
                        let content: string | Uint8Array;
                        try {
                            const decoder = new TextDecoder('utf-8', { fatal: true });
                            content = decoder.decode(combined);
                        } catch {
                            // Not valid UTF-8, keep as binary
                            content = combined;
                        }

                        files.push({
                            path: fullPath,
                            content
                        });
                    }
                }
            }
        };

        await traverseDirectory(cid);

        // Sort files by path for consistent ordering
        files.sort((a, b) => a.path.localeCompare(b.path));

        this.debug(`✅ Downloaded ${files.length} files`);

        return files;
    }

    /**
     * Export a DAG to a CAR file as a Response
     * @param rootCid - Root CID to export (can be string or CID object)
     * @param options - Export options
     * @param options.baselineCid - Optional baseline CID for incremental export (only export blocks not in baseline)
     * @returns Response containing CAR file data that can be written using Bun.write()
     */
    async exportToCAR(
        rootCid: string | CID,
        options?: { baselineCid?: string | CID }
    ): Promise<Response> {
        const cid = typeof rootCid === 'string' ? CID.parse(rootCid) : rootCid;
        this.debug(`Exporting ${cid} to CAR...`);

        // Collect all blocks in the DAG
        let blocks = await this.collectBlocks(cid);

        // If baselineCid is provided, filter out blocks that exist in baseline (incremental export)
        if (options?.baselineCid) {
            const baselineCid = typeof options.baselineCid === 'string'
                ? CID.parse(options.baselineCid)
                : options.baselineCid;

            this.debug(`Collecting baseline blocks from ${baselineCid}...`);
            const baselineBlocks = await this.collectBlocks(baselineCid);

            // Create a set of baseline CIDs for fast lookup
            const baselineCids = new Set(
                baselineBlocks.map(b => b.cid.toString())
            );

            // Filter to only include blocks not in baseline
            const allBlocksCount = blocks.length;
            blocks = blocks.filter(b => !baselineCids.has(b.cid.toString()));

            this.debug(`Incremental export: ${blocks.length} / ${allBlocksCount} blocks (${allBlocksCount - blocks.length} blocks in baseline)`);
        } else {
            this.debug(`Collected ${blocks.length} blocks`);
        }

        // Create CAR file writer
        const { writer, out } = CarWriter.create([cid]);

        // Collect chunks while writing blocks
        const chunks: Uint8Array[] = [];
        const collectPromise = (async () => {
            for await (const chunk of out) {
                chunks.push(chunk);
            }
        })();

        // Write all blocks
        for (const { cid: blockCid, bytes } of blocks) {
            await writer.put({ cid: blockCid, bytes });
        }
        await writer.close();

        // Wait for all chunks to be collected
        await collectPromise;

        // Concatenate chunks into a single Uint8Array
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const carBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            carBytes.set(chunk, offset);
            offset += chunk.length;
        }

        this.debug(`✅ CAR file created: ${carBytes.length} bytes`);

        // Return as a Response (Bun.write handles Response properly)
        return new Response(carBytes, {
            headers: {
                'Content-Type': 'application/vnd.ipld.car',
                'Content-Length': carBytes.length.toString(),
            },
        });
    }

    /**
     * Import a DAG from a CAR file stream
     * @param carStream - ReadableStream from Bun.file or Uint8Array of CAR data
     * @returns Root CID(s) from the CAR file
     */
    async importFromCAR(carStream: ReadableStream<Uint8Array> | Uint8Array): Promise<CID[]> {
        this.debug('Importing from CAR...');

        // Convert stream to bytes if needed
        let carBytes: Uint8Array;
        if (carStream instanceof Uint8Array) {
            carBytes = carStream;
        } else {
            const chunks: Uint8Array[] = [];
            const reader = carStream.getReader();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }

            // Concatenate chunks
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            carBytes = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                carBytes.set(chunk, offset);
                offset += chunk.length;
            }
        }

        // Parse CAR
        const reader = await CarReader.fromBytes(carBytes);

        // Get roots
        const roots = await reader.getRoots();
        this.debug(`CAR roots: ${roots.map(r => r.toString()).join(', ')}`);

        // Import all blocks
        let blockCount = 0;
        for await (const { cid, bytes } of reader.blocks()) {
            await this.putBlock(cid, bytes);
            blockCount++;
        }

        this.debug(`✅ Imported ${blockCount} blocks`);

        return roots;
    }

    /**
     * Collect all blocks in a DAG (recursively)
     * @private
     */
    private async collectBlocks(
        rootCid: CID,
        visited = new Set<string>()
    ): Promise<Array<{ cid: CID; bytes: Uint8Array }>> {
        const cidStr = rootCid.toString();

        if (visited.has(cidStr)) {
            return [];
        }
        visited.add(cidStr);

        this.debug(`Collecting block: ${cidStr} (codec: 0x${rootCid.code.toString(16)})`);

        // Fetch the block
        const bytes = await this.getBlock(rootCid);
        const blocks: Array<{ cid: CID; bytes: Uint8Array }> = [
            { cid: rootCid, bytes }
        ];

        // Decode and find child CIDs based on codec
        try {
            if (rootCid.code === dagCBOR.code) {
                // dag-cbor: decode and extract CIDs
                const data = dagCBOR.decode(bytes);
                const childCids = this.extractCIDsFromData(data);
                this.debug(`Found ${childCids.length} child CIDs in dag-cbor block`);

                for (const childCid of childCids) {
                    const childBlocks = await this.collectBlocks(childCid, visited);
                    blocks.push(...childBlocks);
                }
            } else if (rootCid.code === dagJSON.code) {
                // dag-json: decode and extract CIDs
                const data = dagJSON.decode(bytes);
                const childCids = this.extractCIDsFromData(data);
                this.debug(`Found ${childCids.length} child CIDs in dag-json block`);

                for (const childCid of childCids) {
                    const childBlocks = await this.collectBlocks(childCid, visited);
                    blocks.push(...childBlocks);
                }
            } else if (rootCid.code === dagPB.code) {
                // dag-pb: extract links
                const data = dagPB.decode(bytes);
                if (data.Links) {
                    this.debug(`Found ${data.Links.length} links in dag-pb block`);
                    for (const link of data.Links) {
                        if (link.Hash) {
                            const childBlocks = await this.collectBlocks(link.Hash, visited);
                            blocks.push(...childBlocks);
                        }
                    }
                }
            }
            // For raw blocks, no children to traverse
        } catch (error) {
            // If decoding fails, just include the block itself
            this.debug(`Could not decode block ${cidStr}: ${error}`);
        }

        return blocks;
    }

    /**
     * Extract CIDs from decoded data (recursively)
     * @private
     */
    private extractCIDsFromData(data: any): CID[] {
        const cids: CID[] = [];

        if (data === null || data === undefined) return cids;

        const cid = CID.asCID(data);
        if (cid) {
            cids.push(cid);
            return cids;
        }

        if (Array.isArray(data)) {
            for (const item of data) {
                cids.push(...this.extractCIDsFromData(item));
            }
        } else if (typeof data === 'object') {
            for (const value of Object.values(data)) {
                cids.push(...this.extractCIDsFromData(value));
            }
        }

        return cids;
    }
}


/**
 * IPFS Server class for server-side operations requiring direct repo access
 * Handles key import/export operations that require ipfsRepoPath
 */
export class IPFSServer extends IPFSClient {

    protected ipfsRepoPath: string;
    protected process: any;

    constructor({ connection, ipfsRepoPath = '', verbose = false }: ServerOptions) {
        super({ connection, verbose });
        this.ipfsRepoPath = ipfsRepoPath;
    }

    getRepoPath(): string {
        return this.ipfsRepoPath;
    }

    /**
     * Get environment variables with IPFS_PATH set only if ipfsRepoPath is not empty
     */
    private getEnv(): NodeJS.ProcessEnv {
        return { ...process.env, IPFS_PATH: this.ipfsRepoPath || '' }
    }

    /**
     * Initialize IPFS repository
     * @param options - Initialization options
     * @param options.offline - Whether to configure for offline mode (default: false)
     */
    async init({ offline = false }: { offline?: boolean } = {}): Promise<void> {
        this.debug('Initializing IPFS repo...');

        // Create IPFS repo directory only if ipfsRepoPath is specified
        if (this.ipfsRepoPath) {
            await mkdir(this.ipfsRepoPath, { recursive: true });
        }

        // Check if already initialized
        const configPath = this.ipfsRepoPath ? `${this.ipfsRepoPath}/config` : `${process.env.HOME}/.ipfs/config`;
        const configExists = await Bun.file(configPath).exists();

        if (!configExists) {
            this.debug('Running ipfs init...');
            await Bun.$`ipfs init`.env(this.getEnv()).quiet();
            this.debug('✅ IPFS repo initialized');
        } else {
            this.debug('✅ IPFS repo already initialized');
        }

        // Helper function to retry config commands on lock contention
        const retryConfig = async (command: () => Promise<any>, maxRetries = 5, delayMs = 500): Promise<void> => {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    await command();
                    return;
                } catch (error: any) {
                    const isLockError = error?.stderr?.includes('repo.lock') || error?.message?.includes('repo.lock');
                    if (isLockError && attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                    throw error;
                }
            }
        };

        // Configure ports
        this.debug('Configuring IPFS ports...');
        const apiUrl = new URL(this.connection.rpcUrl);
        const gatewayUrl = new URL(this.connection.gatewayUrl);
        await retryConfig(() => Bun.$`ipfs config Addresses.API /ip4/127.0.0.1/tcp/${apiUrl.port}`.env(this.getEnv()).quiet());
        await retryConfig(() => Bun.$`ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/${gatewayUrl.port}`.env(this.getEnv()).quiet());
        this.debug('✅ IPFS ports configured');

        // Configure for offline mode if requested
        if (offline) {
            this.debug('Configuring IPNS for offline mode...');
            await retryConfig(() => Bun.$`ipfs config --json Ipns.UsePubsub false`.env(this.getEnv()).quiet());
        }
    }

    /**
     * Start IPFS daemon
     * @param options - Start options
     * @param options.offline - Whether to start in offline mode (default: false)
     * @param options.timeout - Timeout in milliseconds (default: 10000)
     * @returns The spawned daemon process
     */
    async start({ offline = false, timeout = 10000 }: { offline?: boolean; timeout?: number } = {}): Promise<any> {
        this.debug('Starting IPFS daemon...');

        // Initialize if not already done
        await this.init({ offline });

        // Build daemon command
        const args = ['daemon'];
        if (offline) {
            args.push('--offline', '--enable-namesys-pubsub=false');
        }

        // Start daemon
        const env = this.ipfsRepoPath
            ? { ...process.env, IPFS_PATH: this.ipfsRepoPath, LIBP2P_ALLOW_WEAK_RSA_KEYS: '1' }
            : { ...process.env, LIBP2P_ALLOW_WEAK_RSA_KEYS: '1' };
        this.process = Bun.spawn(['ipfs', ...args], {
            env,
            stdout: this.verbose ? 'inherit' : 'ignore',
            stderr: this.verbose ? 'inherit' : 'ignore',
        });

        // Wait for daemon to be ready
        await new Promise<void>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new Error('IPFS daemon startup timeout'));
            }, timeout);

            const checkReady = async () => {
                try {
                    const isRunning = await this.isRunning();
                    if (isRunning) {
                        clearTimeout(timeoutHandle);
                        this.debug('✅ IPFS daemon is ready');
                        resolve();
                    } else {
                        setTimeout(checkReady, 500);
                    }
                } catch {
                    setTimeout(checkReady, 500);
                }
            };

            checkReady();
        });

        return this.process;
    }

    /**
     * Stop IPFS daemon by finding and killing the process using the configured port
     * @param options - Stop options
     * @param options.timeout - Timeout in milliseconds to wait for daemon to stop (default: 5000)
     */
    async stop({ timeout = 5000 }: { timeout?: number } = {}): Promise<void> {
        this.debug('Stopping IPFS daemon...');

        const apiUrl = new URL(this.connection.rpcUrl);
        const port = apiUrl.port;

        try {
            // Find process using the port
            const result = await $`lsof -ti:${port}`.text();
            const pids = result.trim().split('\n').filter(p => p);

            let killedAnyDaemon = false;
            for (const pid of pids) {
                // Check if this is actually an IPFS daemon process
                try {
                    const psResult = await $`ps -p ${pid} -o command=`.text();
                    const command = psResult.trim();

                    if (command.includes('ipfs daemon')) {
                        this.debug(`Killing IPFS daemon process ${pid}`);
                        await $`kill -9 ${pid}`.quiet();
                        killedAnyDaemon = true;
                    } else {
                        this.debug(`Skipping non-IPFS process ${pid}: ${command}`);
                    }
                } catch (psErr) {
                    this.debug(`Could not check process ${pid}`);
                }
            }

            // Wait and verify daemon stopped
            if (killedAnyDaemon) {
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Verify daemon is actually stopped
                const startTime = Date.now();
                while (Date.now() - startTime < timeout) {
                    const stillRunning = await this.isRunning();
                    if (!stillRunning) {
                        this.debug('✅ IPFS daemon stopped');
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                throw new Error('IPFS daemon did not stop within timeout');
            } else {
                this.debug('No IPFS daemon found on port');
            }
        } catch (err: any) {
            if (err.message?.includes('timeout')) {
                throw err;
            }
            this.debug('Could not find process using port, daemon may already be stopped');
        }
    }

    /**
     * Ensure IPFS daemon is stopped, stopping it if necessary
     */
    async ensureStopped(): Promise<void> {
        const isRunning = await this.isRunning();
        if (isRunning) {
            await this.stop();
        } else {
            this.debug('IPFS daemon is not running');
        }
    }

    /**
     * Ensure local IPFS is peered with a remote gateway
     * @param options - Gateway configuration
     * @param options.gatewayUrl - Remote gateway URL
     * @param options.gatewayToken - Optional authorization token
     */
    async ensurePeeredWith({ gatewayUrl, gatewayToken }: { gatewayUrl: string; gatewayToken?: string }): Promise<void> {

        if (!gatewayUrl) {
            throw new Error('gatewayUrl is required');
        }

        this.debug(`Attempting to peer with: ${gatewayUrl}`);

        // Check if local IPFS daemon is running
        const isRunning = await this.isRunning();
        if (!isRunning) {
            throw new Error('Local IPFS daemon is not running, cannot peer');
        }

        // Extract the peer ID from the remote gateway
        const remoteGatewayApi = `${gatewayUrl.replace(/\/$/, '')}/api/v0/id`;
        this.debug(`Fetching remote peer info from: ${remoteGatewayApi}`);

        let peerInfo: any;
        try {
            const headers: Record<string, string> = {};
            if (gatewayToken) {
                headers['Authorization'] = `Bearer ${gatewayToken}`;
            }
            const response = await fetch(remoteGatewayApi, {
                method: 'POST',
                headers
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            peerInfo = await response.json();
        } catch (error: any) {
            console.error('remoteGatewayApi', remoteGatewayApi)
            throw new Error(`Could not fetch remote peer info: ${error.message}`);
        }

        if (!peerInfo?.ID) {
            throw new Error('Could not extract peer ID from remote gateway');
        }

        const peerId = peerInfo.ID;
        const peerAddrs = (peerInfo.Addresses || []);
        this.debug(`Remote peer ID: ${peerId}`);
        this.debug(`Remote peer addresses (${peerAddrs.length}):`, peerAddrs.slice(0, 10));

        // Filter out private/local addresses and prioritize public ones
        const isPrivateAddr = (addr: string) => {
            return (
                addr.includes('/ip4/127.') ||
                addr.includes('/ip4/10.') ||
                addr.includes('/ip4/172.') ||
                addr.includes('/ip4/192.') ||
                addr.includes('/ip6/::1/') ||
                addr.includes('/ip6/fe80:')
            )
        };

        // Separate public and private addresses
        const publicAddrs = peerAddrs.filter((addr: string) => !isPrivateAddr(addr));
        const privateAddrs = peerAddrs.filter((addr: string) => isPrivateAddr(addr));

        // Try public addresses first, then private ones
        const addrsToTry = [...publicAddrs, ...privateAddrs].slice(0, 10);

        if (publicAddrs.length > 0) {
            this.debug(`Found ${publicAddrs.length} public addresses, ${privateAddrs.length} private addresses`);
        } else {
            this.debug(`⚠️  No public addresses found, only ${privateAddrs.length} private addresses`);
        }

        // Try to connect to the remote peer using available addresses
        let connected = false;
        const attemptedCommands: string[] = [];

        for (const addr of addrsToTry) {
            if (!addr) continue;

            // Addresses from the API already include the peer ID, so use them as-is
            const command = `ipfs swarm connect ${addr}`;
            attemptedCommands.push(command);
            this.debug(`Attempting to connect: ${addr}`);

            try {
                // Use getEnv() to ensure PATH and IPFS_PATH are set correctly
                const env = this.getEnv();
                const result = await $`ipfs swarm connect ${addr}`.env(env).nothrow();
                if (result.exitCode === 0) {
                    this.debug('✅ Successfully peered with remote gateway');
                    connected = true;
                    break;
                } else if (this.verbose) {
                    this.debug(`  Failed with exit code ${result.exitCode}: ${result.stderr.toString().trim()}`);
                }
            } catch (error: any) {
                if (this.verbose) {
                    this.debug(`  Failed: ${error.message || error}`);
                }
                // Continue to next address
            }
        }

        if (!connected) {
            console.error('\n❌ Failed to peer with remote gateway');
            console.error(`   Gateway: ${gatewayUrl}`);
            console.error(`   Peer ID: ${peerId}`);
            console.error(`   Tried ${addrsToTry.length} addresses (${publicAddrs.length} public, ${privateAddrs.length} private)`);
            console.error('\n💡 You can try these commands manually:');
            attemptedCommands.forEach((cmd, i) => {
                console.error(`   ${i + 1}. ${cmd}`);
            });
            if (this.ipfsRepoPath !== '~/.ipfs') {
                console.error(`\n   Note: Set IPFS_PATH=${this.ipfsRepoPath} if needed`);
            }
            console.error('');
            throw new Error(`Could not establish direct connection to remote peer '${gatewayUrl}' (gatewayToken: ${!!gatewayToken}). Tried ${addrsToTry.length} addresses (${publicAddrs.length} public, ${privateAddrs.length} private).`);
        }
    }

    /**
     * Export an IPNS key to get the private key in PEM format using IPFS CLI
     * @param name - The name of the key to export
     * @returns The private key in PEM format (ASCII)
     */
    async exportIPNSKey(name: string): Promise<string> {
        this.debug(`Exporting IPNS key: ${name}`);

        try {
            // First verify the key exists via API
            this.debug(`Checking if key exists via API...`);
            const keys = await this.listIPNSKeys();
            const keyExists = keys.find(k => k.Name === name);

            if (!keyExists) {
                throw new Error(`Key '${name}' not found in daemon keystore (checked via API)`);
            }
            this.debug(`✓ Key exists in daemon keystore: ${name} (${keyExists.Id})`);

            // Query the daemon for its actual repo path via /api/v0/repo/stat.
            // We cannot rely on this.ipfsRepoPath because the daemon on this port
            // may have been started by a different package with a different repo.
            let actualRepoPath = this.ipfsRepoPath;
            try {
                const repoStatResp = await fetch(`${this.connection.rpcUrl}/api/v0/repo/stat`, { method: 'POST' });
                if (repoStatResp.ok) {
                    const repoStat = await repoStatResp.json() as { RepoPath?: string };
                    if (repoStat.RepoPath) {
                        if (repoStat.RepoPath !== this.ipfsRepoPath) {
                            this.debug(`⚠️ Daemon repo path differs from configured path:`);
                            this.debug(`   Daemon:     ${repoStat.RepoPath}`);
                            this.debug(`   Configured: ${this.ipfsRepoPath}`);
                        }
                        actualRepoPath = repoStat.RepoPath;
                    }
                }
            } catch (e) {
                this.debug(`Could not query daemon repo/stat, using configured path`);
            }

            this.debug(`Exporting key from repo: ${actualRepoPath}`);

            // Verify repo directory exists
            if (!await exists(`${actualRepoPath}/config`)) {
                throw new Error(`IPFS repo does not exist at: ${actualRepoPath}`);
            }
            this.debug(`✓ Repo directory exists: ${actualRepoPath}`);

            // Export to a temporary directory (ipfs key export writes to current directory by default)
            const tmpDir = `/tmp/ipfs-key-export-${Date.now()}`;
            await Bun.$`mkdir -p ${tmpDir}`.quiet();

            const env = { ...process.env, IPFS_PATH: actualRepoPath };
            const proc = Bun.spawn(['ipfs', 'key', 'export', '--format=pem-pkcs8-cleartext', name], {
                stdout: 'pipe',
                stderr: 'pipe',
                env,
                cwd: tmpDir
            });

            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();
            const exitCode = await proc.exited;

            if (exitCode !== 0) {
                throw new Error(`IPFS key export failed (exit ${exitCode}): ${stderr}`);
            }

            // Read the exported key file - format is .pem when using --format=pem-pkcs8-cleartext
            const keyFile = `${tmpDir}/${name}.pem`;
            const keyPem = await Bun.file(keyFile).text();

            // Clean up the temporary directory
            try {
                await $`rm -rf ${tmpDir}`.quiet();
            } catch (e) {
                // Ignore cleanup errors
            }

            if (keyPem.length === 0) {
                throw new Error(`Exported key file is empty`);
            }

            this.debug(`✅ Exported IPNS key: ${name} (${keyPem.length} chars, PEM format)`);
            return keyPem;
        } catch (error: any) {
            throw new Error(`Failed to export IPNS key: ${error.message}`);
        }
    }

    /**
     * Import an IPNS key from exported key PEM string using IPFS CLI
     * @param name - The name for the imported key
     * @param keyPem - The key in PEM format (from exportIPNSKey)
     * @returns Key information including name and id
     */
    async importIPNSKey(
        name: string,
        keyPem: string
    ): Promise<{ Name: string; Id: string }> {
        this.debug(`Importing IPNS key: ${name} (${keyPem.length} chars, PEM format)`);

        // Extract API address from rpcUrl
        const apiUrl = new URL(this.connection.rpcUrl);
        // Convert localhost to 127.0.0.1 for multiaddr format
        const hostname = apiUrl.hostname === 'localhost' ? '127.0.0.1' : apiUrl.hostname;
        const apiAddr = `/ip4/${hostname}/tcp/${apiUrl.port}`;

        try {
            // Use IPFS CLI to import the key
            // Write key to a temporary file since ipfs key import doesn't read from stdin reliably
            const tmpFile = `/tmp/ipfs-key-import-${Date.now()}.pem`;
            await Bun.write(tmpFile, keyPem);

            try {
                // Use --api flag to connect to the specific daemon (must come BEFORE 'key' command)
                this.debug(`Importing key via API: ${apiAddr}`);
                const proc = Bun.spawn(['ipfs', '--api', apiAddr, 'key', 'import', name, '--format=pem-pkcs8-cleartext', tmpFile], {
                    stdout: 'pipe',
                    stderr: 'pipe'
                });

                const output = await new Response(proc.stdout).text();
                const stderr = await new Response(proc.stderr).text();
                const exitCode = await proc.exited;

                if (exitCode !== 0) {
                    throw new Error(`IPFS key import failed (exit ${exitCode}): ${stderr}`);
                }

                // Parse the output to get the key ID
                const keyId = output.trim();

                this.debug(`✅ Imported IPNS key: ${name} (${keyId})`);

                return {
                    Name: name,
                    Id: keyId
                };
            } finally {
                // Clean up temporary file
                try {
                    await Bun.write(tmpFile, ''); // Overwrite with empty content
                    await $`rm ${tmpFile}`.quiet();
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        } catch (error: any) {
            throw new Error(`Failed to import IPNS key: ${error.message}`);
        }
    }

    /**
     * Ensure an IPNS key exists, generating and caching it if needed
     * @param keyName - The name of the IPNS key
     * @returns Key information including name and id
     */
    async ensureIPNSKey(keyName: string): Promise<{ Name: string; Id: string }> {
        const keyFilePath = path.join(this.ipfsRepoPath, `.~ipns-key-${keyName}.pem`);

        // Check if we have a cached key
        const keyFile = Bun.file(keyFilePath);
        if (await keyFile.exists()) {
            this.debug(`📦 Loading cached IPNS key from file: ${keyFilePath}`);
            const keyPem = await keyFile.text();

            // Import the cached key
            try {
                const keyInfo = await this.importIPNSKey(keyName, keyPem);
                this.debug('✅ Imported cached IPNS key:', keyInfo.Name, keyInfo.Id);
                return keyInfo;
            } catch (error: any) {
                // Key might already exist in keystore, try to get it
                if (error.message.includes('already exists') || error.message.includes('duplicate')) {
                    this.debug('⚠️ Key already exists in keystore, listing keys...');
                    const keys = await this.listIPNSKeys();
                    const existingKey = keys.find(k => k.Name === keyName);
                    if (existingKey) {
                        this.debug('✅ Using existing IPNS key:', existingKey.Name, existingKey.Id);
                        return existingKey;
                    }
                }
                throw error;
            }
        } else {
            this.debug('🔑 Generating new IPNS key and caching it...');

            // Generate a new key using IPFS client
            const keyInfo = await this.generateIPNSKey(keyName);
            this.debug('✅ Generated IPNS key:', keyInfo.Name, keyInfo.Id);

            // Export the key to cache it
            const exportedKeyPem = await this.exportIPNSKey(keyName);
            this.debug(`✅ Exported key: ${exportedKeyPem.length} chars (PEM format)`);

            // Cache the key PEM to file
            await Bun.write(keyFilePath, exportedKeyPem);
            this.debug(`✅ Cached key to: ${keyFilePath}`);

            // Emit event for automatic cleanup tracking
            this.emit('ipns:created', keyFilePath);

            return keyInfo;
        }
    }
}
