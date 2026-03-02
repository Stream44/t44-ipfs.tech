import * as bunTest from 'bun:test';
import { run } from '@stream44.studio/t44/standalone-rt';
import { CID, IPFSConnection } from './ipfs';

const {
    test: { describe, it, expect, beforeAll, afterAll },
    ipfs,
} = await run(async ({ encapsulate, CapsulePropertyTypes, makeImportStack }: any) => {
    const spine = await encapsulate({
        '#@stream44.studio/encapsulate/spine-contracts/CapsuleSpineContract.v0': {
            '#@stream44.studio/encapsulate/structs/Capsule': {},
            '#': {
                test: {
                    type: CapsulePropertyTypes.Mapping,
                    value: '@stream44.studio/t44/caps/ProjectTest',
                    options: { '#': { bunTest, env: {} } }
                },
                ipfs: {
                    type: CapsulePropertyTypes.Mapping,
                    value: '@stream44.studio/t44-ipfs.tech/caps/IpfsWorkbench'
                },
            }
        }
    }, {
        importMeta: import.meta,
        importStack: makeImportStack(),
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-client.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

describe('IPFSClient - Base Functionality', () => {

    describe('IPFS Daemon Connectivity', () => {
        it('should verify IPFS daemon is accessible', async () => {
            console.log('Testing IPFS daemon connectivity...');

            const version = await ipfs.testOfflineClient.getIPFSVersion();

            console.log('IPFS version:', version);

            expect(version).toBeDefined();
            expect(version.Version).toBeDefined();

            console.log('✅ IPFS daemon is accessible');
        });

        it('should return true for isIPFSRunning when daemon is running', async () => {
            const isRunning = await ipfs.testOfflineClient.isIPFSRunning();

            expect(isRunning).toBe(true);

            console.log('✅ isIPFSRunning() correctly returns true');
        });
    });

    describe('Block Storage', () => {
        let testCid: CID;
        const testData = new TextEncoder().encode('Hello, IPFS BlockStore!');

        it('should store and retrieve a block', async () => {
            console.log('Testing block storage...');

            // Create a CID for the test data
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            testCid = CID.create(1, 0x55, hash); // CIDv1, raw codec

            console.log(`Test CID: ${testCid.toString()}`);

            // Store the block
            const storedCid = await ipfs.testOfflineClient.putBlock(testCid, testData);

            expect(storedCid.toString()).toBe(testCid.toString());
            console.log('✅ Block stored successfully');

            // Retrieve the block
            const retrievedData = await ipfs.testOfflineClient.getBlock(testCid);

            expect(retrievedData).toEqual(testData);
            console.log('✅ Block retrieved successfully');

            // Verify content matches
            const retrievedText = new TextDecoder().decode(retrievedData);
            expect(retrievedText).toBe('Hello, IPFS BlockStore!');

            console.log('✅ Block content verified');
        });

        it('should check if a block exists', async () => {
            console.log('Testing block existence check...');

            // Check if our test block exists
            const exists = await ipfs.testOfflineClient.hasBlock(testCid);

            expect(exists).toBe(true);
            console.log('✅ Block existence confirmed');

            // Note: Skipping non-existent block check as IPFS may attempt network fetch
            // which can cause timeouts. The positive case is sufficient for validation.
        });

        it('should have sha256 hasher configured', () => {
            expect(ipfs.testOfflineClient.hasher).toBeDefined();
            expect(ipfs.testOfflineClient.hasher.code).toBe(0x12); // SHA-256 code
            console.log('✅ Client hasher is sha256');
        });
    });

    describe('Pin Operations', () => {
        let testCid: string;

        it('should pin a CID', async () => {
            console.log('Testing CID pinning...');

            // Create a simple block to pin
            const testData = new TextEncoder().encode(`Test data for pinning - ${Date.now()}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);

            // Store the block first
            await ipfs.testOfflineClient.putBlock(cid, testData);
            testCid = cid.toString();

            console.log(`Test CID: ${testCid}`);

            // Pin the CID
            await ipfs.testOfflineClient.pinCid(testCid);

            console.log('✅ CID pinned successfully');

            // Verify it's pinned
            const isPinned = await ipfs.testOfflineClient.isPinned(testCid);
            expect(isPinned).toBe(true);

            console.log('✅ Pin verified');
        });

        it('should check if a CID is pinned', async () => {
            console.log('Testing isPinned check...');

            const isPinned = await ipfs.testOfflineClient.isPinned(testCid);

            expect(isPinned).toBe(true);
            console.log('✅ isPinned() correctly returns true for pinned CID');
        });

        it('should unpin a CID', async () => {
            console.log('Testing CID unpinning...');

            // Unpin the CID
            await ipfs.testOfflineClient.unpinCid(testCid);

            console.log('✅ CID unpinned successfully');

            // Verify it's no longer pinned
            const isPinned = await ipfs.testOfflineClient.isPinned(testCid);
            expect(isPinned).toBe(false);

            console.log('✅ Unpin verified');
        });

        it('should return false for isPinned on non-pinned CID', async () => {
            console.log('Testing isPinned on non-pinned CID...');

            const isPinned = await ipfs.testOfflineClient.isPinned(testCid);

            expect(isPinned).toBe(false);
            console.log('✅ isPinned() correctly returns false for unpinned CID');
        });
    });

    describe('MFS (Mutable File System) Operations', () => {
        let testCid: string;
        const mfsPath = '/test-IPFSClient/test-file';

        beforeAll(async () => {
            // Create and pin a test block
            const testData = new TextEncoder().encode(`MFS test data - ${Date.now()}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);

            await ipfs.testOfflineClient.putBlock(cid, testData);
            testCid = cid.toString();

            await ipfs.testOfflineClient.pinCid(testCid);

            console.log(`Created test CID for MFS tests: ${testCid}`);
        });

        it('should copy a CID to MFS', async () => {
            console.log('Testing copyToMFS...');

            await ipfs.testOfflineClient.copyToMFS(testCid, mfsPath);

            console.log(`✅ CID copied to MFS: ${mfsPath}`);

            // Verify it exists
            const exists = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(exists).toBe(true);

            console.log('✅ MFS path verified');
        });

        it('should check if a path exists in MFS', async () => {
            console.log('Testing existsInMFS...');

            const exists = await ipfs.testOfflineClient.existsInMFS(mfsPath);

            expect(exists).toBe(true);
            console.log('✅ existsInMFS() correctly returns true for existing path');

            // Check non-existent path
            const notExists = await ipfs.testOfflineClient.existsInMFS('/test-IPFSClient/non-existent');

            expect(notExists).toBe(false);
            console.log('✅ existsInMFS() correctly returns false for non-existent path');
        });

        it('should remove a path from MFS', async () => {
            console.log('Testing removeFromMFS...');

            await ipfs.testOfflineClient.removeFromMFS(mfsPath);

            console.log(`✅ MFS path removed: ${mfsPath}`);

            // Verify it no longer exists
            const exists = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(exists).toBe(false);

            console.log('✅ MFS removal verified');
        });

        it('should handle nested MFS paths', async () => {
            console.log('Testing nested MFS paths...');

            const nestedPath = '/test-IPFSClient/nested/deep/path/file';

            await ipfs.testOfflineClient.copyToMFS(testCid, nestedPath);

            console.log(`✅ CID copied to nested MFS path: ${nestedPath}`);

            const exists = await ipfs.testOfflineClient.existsInMFS(nestedPath);
            expect(exists).toBe(true);

            console.log('✅ Nested MFS path verified');

            // Clean up
            await ipfs.testOfflineClient.removeFromMFS(nestedPath);

            const stillExists = await ipfs.testOfflineClient.existsInMFS(nestedPath);
            expect(stillExists).toBe(false);

            console.log('✅ Nested MFS path removed');
        });
    });

    describe('Integration: Pin + MFS Workflow', () => {
        it('should support full pin and MFS lifecycle', async () => {
            console.log('Testing full pin + MFS lifecycle...');

            const timestamp = Date.now();
            const testData = new TextEncoder().encode(`Lifecycle test - ${timestamp}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);
            const cidString = cid.toString();
            const mfsPath = `/test-IPFSClient/lifecycle-${timestamp}`;

            console.log(`\n=== Step 1: Store block ===`);
            await ipfs.testOfflineClient.putBlock(cid, testData);
            console.log(`✅ Block stored: ${cidString}`);

            console.log(`\n=== Step 2: Pin CID ===`);
            await ipfs.testOfflineClient.pinCid(cidString);
            const isPinned = await ipfs.testOfflineClient.isPinned(cidString);
            expect(isPinned).toBe(true);
            console.log(`✅ CID pinned and verified`);

            console.log(`\n=== Step 3: Copy to MFS ===`);
            await ipfs.testOfflineClient.copyToMFS(cidString, mfsPath);
            const existsInMfs = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(existsInMfs).toBe(true);
            console.log(`✅ CID copied to MFS and verified`);

            console.log(`\n=== Step 4: Remove from MFS ===`);
            await ipfs.testOfflineClient.removeFromMFS(mfsPath);
            const stillInMfs = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(stillInMfs).toBe(false);
            console.log(`✅ MFS path removed and verified`);

            console.log(`\n=== Step 5: Unpin CID ===`);
            await ipfs.testOfflineClient.unpinCid(cidString);
            const stillPinned = await ipfs.testOfflineClient.isPinned(cidString);
            expect(stillPinned).toBe(false);
            console.log(`✅ CID unpinned and verified`);

            console.log(`\n✅ Full lifecycle completed successfully`);
        });

        it('should handle unpinning non-existent CID with ignoreMissing option', async () => {
            console.log('\n=== Testing unpinCid with ignoreMissing ===');

            // Create a fake CID that doesn't exist
            const fakeCid = 'QmNotARealCIDThatDoesNotExist123456789012345678';

            console.log(`\n=== Step 1: Try to unpin non-existent CID without ignoreMissing (should throw) ===`);
            let errorThrown = false;
            try {
                await ipfs.testOfflineClient.unpinCid(fakeCid);
            } catch (error) {
                errorThrown = true;
                console.log(`✅ Error thrown as expected: ${error}`);
            }
            expect(errorThrown).toBe(true);

            console.log(`\n=== Step 2: Try to unpin non-existent CID with ignoreMissing (should not throw) ===`);
            await ipfs.testOfflineClient.unpinCid(fakeCid, { ignoreMissing: true });
            console.log(`✅ No error thrown with ignoreMissing option`);

            console.log(`\n✅ ignoreMissing option works correctly`);
        });
    });

    describe('IPFSConnection Serialization', () => {
        it('should serialize connection to JSON', () => {
            console.log('Testing IPFSConnection.toJSON()...');

            const connection = ipfs.testOfflineClient.getConnection();

            const json = connection.toJSON();

            expect(json).toBeDefined();
            expect(json.rpcUrl).toBeDefined();
            expect(json.gatewayUrl).toBeDefined();
            // Ports are not included in JSON, they're extracted from URLs by fromJSON()
            expect('rpcPort' in json).toBe(false);
            expect('gatewayPort' in json).toBe(false);

            console.log('✅ Connection serialized to JSON:', json);
        });

        it('should deserialize connection from JSON', () => {
            console.log('Testing IPFSConnection.fromJSON()...');

            const jsonData = {
                rpcUrl: 'http://127.0.0.1:5001',
                gatewayUrl: 'http://127.0.0.1:8080'
            };

            const connection = IPFSConnection.fromJSON(jsonData);

            expect(connection).toBeDefined();
            expect(connection.rpcUrl).toBe(jsonData.rpcUrl);
            expect(connection.rpcPort).toBe(5001); // Extracted from URL
            expect(connection.gatewayUrl).toBe(jsonData.gatewayUrl);
            expect(connection.gatewayPort).toBe(8080); // Extracted from URL

            console.log('✅ Connection deserialized from JSON');
        });

        it('should round-trip serialize and deserialize', () => {
            console.log('Testing JSON round-trip...');

            const originalConnection = ipfs.testOfflineClient.getConnection();

            const json = originalConnection.toJSON();
            const restoredConnection = IPFSConnection.fromJSON(json);

            expect(restoredConnection.rpcUrl).toBe(originalConnection.rpcUrl);
            expect(restoredConnection.rpcPort).toBe(originalConnection.rpcPort);
            expect(restoredConnection.gatewayUrl).toBe(originalConnection.gatewayUrl);
            expect(restoredConnection.gatewayPort).toBe(originalConnection.gatewayPort);

            console.log('✅ Round-trip serialization successful');
        });

        it('should load connection from environment variable', () => {
            console.log('Testing IPFSConnection.fromEnv()...');

            const testEnvVar = 'TEST_IPFS_CONNECTION';
            const testConfig = JSON.stringify({
                rpcUrl: 'http://test.example.com:5001',
                gatewayUrl: 'http://test.example.com:8080'
            });

            globalThis.process.env[testEnvVar] = testConfig;

            const connection = IPFSConnection.fromEnv(testEnvVar);

            expect(connection).toBeDefined();
            expect(connection.rpcUrl).toBe('http://test.example.com:5001');
            expect(connection.rpcPort).toBe(5001); // Extracted from URL
            expect(connection.gatewayUrl).toBe('http://test.example.com:8080');
            expect(connection.gatewayPort).toBe(8080); // Extracted from URL

            // Cleanup
            delete globalThis.process.env[testEnvVar];

            console.log('✅ Connection loaded from environment variable');
        });

        it('should throw error when environment variable is missing', () => {
            console.log('Testing IPFSConnection.fromEnv() with missing env var...');

            const missingEnvVar = 'MISSING_IPFS_CONNECTION';

            expect(() => {
                IPFSConnection.fromEnv(missingEnvVar);
            }).toThrow('Missing environment variable: MISSING_IPFS_CONNECTION');

            console.log('✅ Correctly throws error for missing environment variable');
        });
    });

    describe('Gateway Fetch', () => {
        let testCid: CID;
        const testContent = 'Hello from IPFS Gateway!';

        it('should fetch content from IPFS gateway using CID', async () => {
            console.log('Testing gateway fetch with CID...');

            // Create and store test content
            const testData = new TextEncoder().encode(testContent);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            testCid = CID.create(1, 0x55, hash); // CIDv1, raw codec

            // Store the block first
            await ipfs.testOfflineClient.putBlock(testCid, testData);
            await ipfs.testOfflineClient.pinCid(testCid.toString());

            console.log(`Test CID: ${testCid.toString()}`);

            // Fetch from gateway
            const fetchedData = await ipfs.testOfflineClient.fetch(testCid);

            expect(fetchedData).toEqual(testData);

            const fetchedText = new TextDecoder().decode(fetchedData);
            expect(fetchedText).toBe(testContent);

            console.log('✅ Successfully fetched content from gateway using CID object');
        });

        it('should fetch content from IPFS gateway using CID string', async () => {
            console.log('Testing gateway fetch with CID string...');

            const cidString = testCid.toString();
            const fetchedData = await ipfs.testOfflineClient.fetch(cidString);

            const fetchedText = new TextDecoder().decode(fetchedData);
            expect(fetchedText).toBe(testContent);

            console.log('✅ Successfully fetched content from gateway using CID string');
        });

        it('should fetch content with filepath from IPFS gateway', async () => {
            console.log('Testing gateway fetch with filepath...');

            // For this test, we'll use the CID without a path since we're using raw blocks
            // In a real scenario with UnixFS directories, you'd specify a path like 'file.txt'
            const fetchedData = await ipfs.testOfflineClient.fetch(testCid, '');

            const fetchedText = new TextDecoder().decode(fetchedData);
            expect(fetchedText).toBe(testContent);

            console.log('✅ Successfully fetched content with filepath parameter');
        });

        it('should throw error with response attached when fetch fails', async () => {
            console.log('Testing gateway fetch error handling...');

            // Use a non-existent CID
            const nonExistentCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

            try {
                await ipfs.testOfflineClient.fetch(nonExistentCid);
                // Should not reach here
                expect(true).toBe(false);
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.message).toContain('Failed to fetch from IPFS gateway');
                expect(error.response).toBeDefined();
                expect(error.response.status).not.toBe(200);

                console.log(`✅ Error thrown with status: ${error.response.status}`);
                console.log('✅ Response object attached to error');
            }
        });
    });
});
