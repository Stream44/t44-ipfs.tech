import { CID } from 'multiformats/cid';
import { CarReader } from '@ipld/car';
import type { IPFSClient } from './ipfs';
import type { FileOutput } from './ipfs';
import { IPFSConnection } from './ipfs';
import { exporter } from 'ipfs-unixfs-exporter';
import { join } from 'node:path';
import type { Server } from 'bun';

/**
 * IPFS server that loads data from CAR files instead of IPFS
 * Includes an embedded HTTP server that serves IPFS content from CAR files
 */
export class IPFSCarServer implements Partial<IPFSClient> {
    private carDirectory: string;
    private carCache: Map<string, Map<string, Uint8Array>> = new Map();
    private verbose: boolean;
    private server: Server<any> | null = null;
    private port: number;
    private hostname: string;

    constructor({ carDirectory, port = 8080, hostname = '127.0.0.1', verbose = false }: { carDirectory: string; port?: number; hostname?: string; verbose?: boolean }) {
        this.carDirectory = carDirectory;
        this.port = port;
        this.hostname = hostname;
        this.verbose = verbose;
    }

    private debug(...args: any[]) {
        if (this.verbose) {
            console.log('[IPFSCarServer]', ...args);
        }
    }

    // 
    getGatewayUrl(): string {
        if (!this.server) {
            throw new Error('Server is not running. Call start() first.');
        }
        return `http://${this.hostname}:${this.port}`;
    }

    getConnection(): IPFSConnection {
        // Return a connection object with the gateway URL
        // Note: CAR server doesn't have an RPC endpoint, so we use the same URL for both
        return new IPFSConnection({
            protocol: 'http',
            hostname: this.hostname,
            rpcPort: this.port,
            gatewayPort: this.port
        });
    }

    /**
     * Start the embedded HTTP server
     */
    async start(): Promise<void> {
        if (this.server) {
            this.debug('Server is already running');
            return;
        }

        this.server = Bun.serve({
            port: this.port,
            hostname: this.hostname,
            fetch: async (req) => {
                const url = new URL(req.url);
                this.debug(`Request: ${url.pathname}`);

                // Handle /api/v0/block/get?arg=<cid> format (RPC API)
                if (url.pathname === '/api/v0/block/get') {
                    const cid = url.searchParams.get('arg');
                    if (!cid) {
                        return new Response('Missing CID argument', { status: 400 });
                    }
                    return this.handleBlockGetRequest(cid);
                }

                // Handle /ipfs/:cid/:path format (Gateway API)
                const ipfsMatch = url.pathname.match(/^\/ipfs\/([^\/]+)(?:\/(.+))?$/);
                if (ipfsMatch) {
                    const [, cid, path] = ipfsMatch;
                    return this.handleIPFSRequest(cid, path || '');
                }

                return new Response('Not Found', { status: 404 });
            },
        });

        // Update port if auto-assigned (port 0)
        if (this.server.port !== undefined) {
            this.port = this.server.port;
        }

        this.debug(`Server started at http://${this.hostname}:${this.port}`);
    }

    /**
     * Stop the embedded HTTP server
     */
    async stop(): Promise<void> {
        if (this.server) {
            this.server.stop();
            this.server = null;
            this.debug('Server stopped');
        }
    }

    /**
     * Handle block get requests (/api/v0/block/get?arg=<cid>)
     * Returns the raw block data for a given CID
     */
    private async handleBlockGetRequest(cidString: string): Promise<Response> {
        try {
            this.debug(`Handling block get request: CID=${cidString}`);

            // Parse the CID
            const cid = CID.parse(cidString);

            // First, try to load a CAR file with this CID as the root
            try {
                const blocks = await this.loadCarFile(cidString);
                const block = blocks.get(cidString);
                if (block) {
                    this.debug(`✅ Found block in CAR file: ${cidString} (${block.byteLength} bytes)`);
                    return new Response(block as any);
                }
            } catch (e) {
                // CAR file doesn't exist with this CID as root, continue searching
                this.debug(`No CAR file with root CID: ${cidString}, searching all CAR files...`);
            }

            // Search through all CAR files to find the block
            const { readdirSync } = await import('fs');
            const files = readdirSync(this.carDirectory).filter(f => f.endsWith('.car'));

            for (const file of files) {
                const rootCid = file.replace('.car', '');
                try {
                    const blocks = await this.loadCarFile(rootCid);
                    const block = blocks.get(cidString);
                    if (block) {
                        this.debug(`✅ Found block in CAR file ${rootCid}: ${cidString} (${block.byteLength} bytes)`);
                        return new Response(block as any);
                    }
                } catch (e) {
                    // Skip this CAR file
                    continue;
                }
            }

            this.debug(`Block not found in any CAR file: ${cidString}`);
            return new Response('Not Found', { status: 404 });
        } catch (error: any) {
            this.debug(`Error handling block get request: ${error.message}`);
            return new Response(`Not Found`, { status: 404 });
        }
    }

    /**
     * Handle IPFS requests by serving content from CAR files
     */
    private async handleIPFSRequest(cid: string, path: string): Promise<Response> {
        try {
            this.debug(`Handling IPFS request: CID=${cid}, path=${path}`);

            // Load the CAR file and get all files
            const files = await this.exportFiles(cid);

            this.debug(`Available files in CAR:`, files.map(f => f.path));
            this.debug(`Looking for path: "${path}"`);

            // Find the requested file
            const file = files.find(f => f.path === path);
            if (!file) {
                this.debug(`File not found: ${path}`);
                this.debug(`Available paths:`, files.map(f => `"${f.path}"`).join(', '));
                return new Response('Not Found', { status: 404 });
            }

            // Determine content type
            const contentType = this.getContentType(path);

            // Return the file content
            if (typeof file.content === 'string') {
                return new Response(file.content, {
                    headers: { 'Content-Type': contentType },
                });
            } else {
                return new Response(file.content, {
                    headers: { 'Content-Type': contentType },
                });
            }
        } catch (error: any) {
            this.debug(`Error handling request: ${error.message}`);
            return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
        }
    }

    /**
     * Get content type based on file extension
     */
    private getContentType(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        const contentTypes: Record<string, string> = {
            'js': 'application/javascript',
            'json': 'application/json',
            'html': 'text/html',
            'css': 'text/css',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
        };
        return contentTypes[ext || ''] || 'application/octet-stream';
    }

    /**
     * Load a CAR file and cache its blocks
     */
    private async loadCarFile(cid: string): Promise<Map<string, Uint8Array>> {
        if (this.carCache.has(cid)) {
            this.debug(`Using cached CAR for CID: ${cid}`);
            return this.carCache.get(cid)!;
        }

        const carPath = join(this.carDirectory, `${cid}.car`);
        this.debug(`Loading CAR file: ${carPath}`);

        try {
            const carFile = Bun.file(carPath);
            const exists = await carFile.exists();
            if (!exists) {
                this.debug(`❌ CAR file does not exist: ${carPath}`);
                this.debug(`   CAR directory: ${this.carDirectory}`);
                // List files in the directory to help debug
                try {
                    const { readdirSync } = await import('fs');
                    const files = readdirSync(this.carDirectory);
                    this.debug(`   Available CAR files: ${files.filter(f => f.endsWith('.car')).join(', ')}`);
                } catch (e) {
                    this.debug(`   Could not list directory: ${e}`);
                }
                throw new Error(`CAR file not found: ${carPath}`);
            }

            const carBytes = await carFile.arrayBuffer();
            const reader = await CarReader.fromBytes(new Uint8Array(carBytes));

            const blocks = new Map<string, Uint8Array>();
            for await (const { cid: blockCid, bytes } of reader.blocks()) {
                blocks.set(blockCid.toString(), bytes);
                this.debug(`  Loaded block: ${blockCid.toString()}`);
            }

            this.carCache.set(cid, blocks);
            this.debug(`✅ Loaded ${blocks.size} blocks from CAR file`);
            return blocks;
        } catch (error) {
            throw new Error(`Failed to load CAR file for CID ${cid}: ${error}`);
        }
    }

    /**
     * Export files from a CID by loading from CAR file
     */
    async exportFiles(rootCid: string): Promise<FileOutput[]> {
        this.debug(`Exporting files from CID: ${rootCid}`);

        const blocks = await this.loadCarFile(rootCid);
        const files: FileOutput[] = [];

        // Create a blockstore interface for the exporter
        const blockstore = {
            get: async (cid: CID) => {
                const block = blocks.get(cid.toString());
                if (!block) {
                    throw new Error(`Block not found: ${cid.toString()}`);
                }
                return block;
            }
        };

        // Parse the CID
        const cid = CID.parse(rootCid);

        // Export the root directory using ipfs-unixfs-exporter
        const rootEntry = await exporter(cid, blockstore);

        this.debug(`Root entry type: ${rootEntry.type}, name: ${rootEntry.name}`);

        if (rootEntry.type !== 'directory') {
            throw new Error('Root CID must point to a directory');
        }

        // Iterate through directory entries
        for await (const entry of rootEntry.content()) {
            this.debug(`  Found entry: name="${entry.name}", type=${entry.type}, cid=${entry.cid.toString()}`);
            if (entry.type === 'file' || entry.type === 'raw') {
                // Read file content
                const fileEntry = await exporter(entry.cid, blockstore);

                if (fileEntry.type === 'file' || fileEntry.type === 'raw') {
                    // Collect all chunks
                    const chunks: Uint8Array[] = [];
                    for await (const chunk of fileEntry.content()) {
                        chunks.push(chunk);
                    }

                    // Combine chunks
                    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.length;
                    }

                    // Try to decode as UTF-8 text
                    let fileContent: string | Uint8Array;
                    try {
                        const decoder = new TextDecoder('utf-8', { fatal: true });
                        fileContent = decoder.decode(combined);
                    } catch {
                        fileContent = combined;
                    }

                    files.push({
                        path: entry.name,
                        content: fileContent
                    });

                    this.debug(`  Exported file: ${entry.name} (${typeof fileContent === 'string' ? fileContent.length + ' chars' : fileContent.length + ' bytes'})`);
                }
            }
        }

        this.debug(`✅ Exported ${files.length} files`);
        return files;
    }

}