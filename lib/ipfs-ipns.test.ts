import * as bunTest from 'bun:test';
import { run } from 't44/standalone-rt';
import { CID } from './ipfs';

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
                    value: 't44/caps/WorkspaceTest',
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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-ipns.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

// Track IPNS keys for cleanup
const testKeys: string[] = [];

afterAll(async () => {
    // Clean up test keys
    for (const keyName of testKeys) {
        try {
            await ipfs.testOfflineClient.removeIPNSKey(keyName);
            console.log(`✅ Cleaned up IPNS key: ${keyName}`);
        } catch (error) {
            console.log(`⚠️ Failed to clean up IPNS key ${keyName}:`, error);
        }
    }
});

describe('IPFSClient - IPNS Operations', () => {

    describe('IPNS Key Management', () => {
        const keyName = `test-key-${Date.now()}`;
        let keyId: string;

        it('should generate a new IPNS key', async () => {
            console.log('Testing IPNS key generation...');

            const result = await ipfs.testOfflineClient.generateIPNSKey(keyName);
            testKeys.push(keyName);

            expect(result).toBeDefined();
            expect(result.Name).toBe(keyName);
            expect(result.Id).toBeDefined();
            expect(typeof result.Id).toBe('string');
            expect(result.Id.length).toBeGreaterThan(0);

            keyId = result.Id;
            console.log(`✅ Generated IPNS key: ${result.Name} (${result.Id})`);
        });

        it('should list IPNS keys', async () => {
            console.log('Testing IPNS key listing...');

            const keys = await ipfs.testOfflineClient.listIPNSKeys();

            expect(keys).toBeDefined();
            expect(Array.isArray(keys)).toBe(true);
            expect(keys.length).toBeGreaterThan(0);

            // Find our test key
            const ourKey = keys.find(k => k.Name === keyName);
            expect(ourKey).toBeDefined();
            expect(ourKey?.Id).toBe(keyId);

            console.log(`✅ Found ${keys.length} IPNS keys, including our test key`);
        });

        it('should remove an IPNS key', async () => {
            console.log('Testing IPNS key removal...');

            const result = await ipfs.testOfflineClient.removeIPNSKey(keyName);

            expect(result).toBeDefined();
            expect(result.Name).toBe(keyName);
            expect(result.Id).toBe(keyId);

            // Remove from cleanup list since we already removed it
            const index = testKeys.indexOf(keyName);
            if (index > -1) {
                testKeys.splice(index, 1);
            }

            console.log(`✅ Removed IPNS key: ${result.Name} (${result.Id})`);

            // Verify it's no longer in the list
            const keys = await ipfs.testOfflineClient.listIPNSKeys();
            const removedKey = keys.find(k => k.Name === keyName);
            expect(removedKey).toBeUndefined();

            console.log(`✅ Verified key is no longer in list`);
        });
    });

    describe('IPNS Key Import/Export', () => {
        const exportKeyName = `test-export-key-${Date.now()}`;
        const importKeyName = `test-import-key-${Date.now()}`;
        let exportedKeyPem: string;
        let originalKeyId: string;

        it('should generate a key and export it', async () => {
            console.log('Generating key and exporting...');

            // Generate a key using IPFS client
            const keyInfo = await ipfs.testOfflineClient.generateIPNSKey(exportKeyName);
            testKeys.push(exportKeyName);
            originalKeyId = keyInfo.Id;

            console.log(`✅ Generated IPNS key: ${keyInfo.Name} (${keyInfo.Id})`);

            // Export the key in PEM format
            const server = await ipfs.testOfflineServer;
            exportedKeyPem = await server.exportIPNSKey(exportKeyName);

            expect(exportedKeyPem).toBeDefined();
            expect(typeof exportedKeyPem).toBe('string');
            expect(exportedKeyPem.length).toBeGreaterThan(0);
            expect(exportedKeyPem).toContain('BEGIN PRIVATE KEY');
            expect(exportedKeyPem).toContain('END PRIVATE KEY');

            console.log(`✅ Exported key: ${exportedKeyPem.length} chars (PEM format)`);
        });

        it('should import a key from exported PEM', async () => {
            console.log('Testing IPNS key import...');

            const server = await ipfs.testOfflineServer;
            const result = await server.importIPNSKey(importKeyName, exportedKeyPem);
            testKeys.push(importKeyName);

            expect(result).toBeDefined();
            expect(result.Name).toBe(importKeyName);
            expect(result.Id).toBeDefined();
            expect(typeof result.Id).toBe('string');
            expect(result.Id.length).toBeGreaterThan(0);

            console.log(`✅ Imported IPNS key: ${result.Name} (${result.Id})`);
            console.log(`   Original key ID: ${originalKeyId}, Imported key ID: ${result.Id}`);
        });

        it('should verify imported key is in keystore', async () => {
            console.log('Verifying imported key is in keystore...');

            const keys = await ipfs.testOfflineClient.listIPNSKeys();
            const importedKey = keys.find(k => k.Name === importKeyName);

            expect(importedKey).toBeDefined();
            expect(importedKey?.Id).toBeDefined();
            expect(importedKey?.Id.length).toBeGreaterThan(0);

            console.log(`✅ Imported key found in keystore: ${importedKey?.Name} (${importedKey?.Id})`);
        });

        it('should be able to publish with imported key', async () => {
            console.log('Testing IPNS publish with imported key...');

            // Create a test CID
            const testData = new TextEncoder().encode(`Import test data - ${Date.now()}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);
            const cidString = cid.toString();

            await ipfs.testOfflineClient.putBlock(cid, testData);
            await ipfs.testOfflineClient.pinCid(cidString);

            console.log(`✅ Test CID created: ${cidString}`);

            // Publish using the imported key
            const ipnsName = await ipfs.testOfflineClient.publishToIPNS(cidString, { key: importKeyName });

            expect(ipnsName).toBeDefined();
            expect(ipnsName.length).toBeGreaterThan(0);
            console.log(`✅ Published to IPNS with imported key: ${ipnsName}`);

            // Resolve to verify
            const resolvedPath = await ipfs.testOfflineClient.resolveIPNS(ipnsName);
            expect(resolvedPath).toContain(cidString);

            console.log(`✅ IPNS resolves correctly: ${resolvedPath}`);
        }, 30000); // 30 second timeout for IPNS operations

        it('should fail to import key with duplicate name', async () => {
            console.log('Testing duplicate key name rejection...');

            try {
                const server = await ipfs.testOfflineServer;
                await server.importIPNSKey(importKeyName, exportedKeyPem);
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.message).toContain('Failed to import IPNS key');
                console.log(`✅ Correctly rejected duplicate key name: ${error.message}`);
            }
        });
    });

    describe('IPNS Publish and Resolve with Default Key', () => {
        const defaultKeyName = `test-default-${Date.now()}`;
        let testCid: string;
        let ipnsName: string;

        beforeAll(async () => {
            console.log('\n=== Creating test CID for IPNS ===');

            // Generate a key for this test to avoid conflicts with existing 'self' key
            const keyInfo = await ipfs.testOfflineClient.generateIPNSKey(defaultKeyName);
            testKeys.push(defaultKeyName);
            console.log(`✅ Generated test key: ${defaultKeyName} (${keyInfo.Id})`);

            // Create a simple block to publish
            const testData = new TextEncoder().encode(`IPNS test data - ${Date.now()}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);

            await ipfs.testOfflineClient.putBlock(cid, testData);
            testCid = cid.toString();

            // Pin it
            await ipfs.testOfflineClient.pinCid(testCid);

            console.log(`✅ Test CID created and pinned: ${testCid}`);
        });

        it('should publish CID to IPNS using default key', async () => {
            console.log('Testing IPNS publish with default key...');

            ipnsName = await ipfs.testOfflineClient.publishToIPNS(testCid, { key: defaultKeyName });

            expect(ipnsName).toBeDefined();
            expect(typeof ipnsName).toBe('string');
            expect(ipnsName.length).toBeGreaterThan(0);

            console.log(`✅ Published to IPNS: ${ipnsName}`);
        }, 30000); // 30 second timeout for IPNS publish

        it('should resolve IPNS name to CID', async () => {
            console.log('Testing IPNS resolve...');

            const resolvedPath = await ipfs.testOfflineClient.resolveIPNS(ipnsName);

            expect(resolvedPath).toBeDefined();
            expect(resolvedPath).toContain('/ipfs/');
            expect(resolvedPath).toContain(testCid);

            console.log(`✅ Resolved IPNS: ${ipnsName} -> ${resolvedPath}`);
        }, 30000); // 30 second timeout for IPNS resolve

        it('should update IPNS name with new CID', async () => {
            console.log('Testing IPNS update...');

            // Create a new CID
            const newTestData = new TextEncoder().encode(`Updated IPNS test data - ${Date.now()}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(newTestData);
            const newCid = CID.create(1, 0x55, hash);

            await ipfs.testOfflineClient.putBlock(newCid, newTestData);
            const newCidString = newCid.toString();

            await ipfs.testOfflineClient.pinCid(newCidString);

            console.log(`✅ New CID created: ${newCidString}`);

            // Publish the new CID to the same IPNS name
            const updatedIpnsName = await ipfs.testOfflineClient.publishToIPNS(newCidString, { key: defaultKeyName });

            expect(updatedIpnsName).toBe(ipnsName);

            console.log(`✅ Updated IPNS name: ${updatedIpnsName}`);

            // Resolve and verify it points to the new CID
            const resolvedPath = await ipfs.testOfflineClient.resolveIPNS(ipnsName, { nocache: true });

            expect(resolvedPath).toContain(newCidString);

            console.log(`✅ IPNS now resolves to new CID: ${resolvedPath}`);
        }, 30000); // 30 second timeout for IPNS update
    });

    describe('IPNS Publish and Resolve with Custom Key', () => {
        const customKeyName = `test-custom-key-${Date.now()}`;
        let testCid: string;
        let keyId: string;
        let ipnsName: string;

        beforeAll(async () => {
            console.log('\n=== Setting up custom key test ===');

            // Generate a custom key
            const keyInfo = await ipfs.testOfflineClient.generateIPNSKey(customKeyName);
            testKeys.push(customKeyName);
            keyId = keyInfo.Id;

            console.log(`✅ Custom key generated: ${customKeyName} (${keyId})`);

            // Create a test CID
            const testData = new TextEncoder().encode(`Custom key test data - ${Date.now()}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);

            await ipfs.testOfflineClient.putBlock(cid, testData);
            testCid = cid.toString();

            await ipfs.testOfflineClient.pinCid(testCid);

            console.log(`✅ Test CID created: ${testCid}`);
        });

        it('should publish CID to IPNS using custom key', async () => {
            console.log('Testing IPNS publish with custom key...');

            ipnsName = await ipfs.testOfflineClient.publishToIPNS(testCid, { key: customKeyName });

            expect(ipnsName).toBeDefined();
            expect(typeof ipnsName).toBe('string');
            expect(ipnsName.length).toBeGreaterThan(0);
            expect(ipnsName).toBe(keyId);

            console.log(`✅ Published to IPNS with custom key: ${ipnsName}`);
        }, 30000); // 30 second timeout for IPNS publish

        it('should resolve IPNS name from custom key', async () => {
            console.log('Testing IPNS resolve with custom key...');

            const resolvedPath = await ipfs.testOfflineClient.resolveIPNS(ipnsName);

            expect(resolvedPath).toBeDefined();
            expect(resolvedPath).toContain('/ipfs/');
            expect(resolvedPath).toContain(testCid);

            console.log(`✅ Resolved custom key IPNS: ${ipnsName} -> ${resolvedPath}`);
        }, 30000); // 30 second timeout for IPNS resolve

        it('should publish with custom lifetime and ttl', async () => {
            console.log('Testing IPNS publish with custom options...');

            const newIpnsName = await ipfs.testOfflineClient.publishToIPNS(testCid, {
                key: customKeyName,
                lifetime: '48h',
                ttl: '1h'
            });

            expect(newIpnsName).toBe(ipnsName);

            console.log(`✅ Published with custom lifetime and ttl: ${newIpnsName}`);
        }, 30000); // 30 second timeout for IPNS publish
    });

    describe('Integration: IPNS with Block Operations', () => {
        const integrationKeyName = `test-integration-${Date.now()}`;
        let keyId: string;

        beforeAll(async () => {
            const keyInfo = await ipfs.testOfflineClient.generateIPNSKey(integrationKeyName);
            testKeys.push(integrationKeyName);
            keyId = keyInfo.Id;

            console.log(`✅ Integration key generated: ${integrationKeyName} (${keyId})`);
        });

        it('should support full IPNS lifecycle', async () => {
            console.log('Testing full IPNS lifecycle...');

            const timestamp = Date.now();

            console.log(`\n=== Step 1: Create and store block ===`);
            const testData = new TextEncoder().encode(`Lifecycle test - ${timestamp}`);
            const hash = await ipfs.testOfflineClient.hasher.digest(testData);
            const cid = CID.create(1, 0x55, hash);
            const cidString = cid.toString();

            await ipfs.testOfflineClient.putBlock(cid, testData);
            console.log(`✅ Block stored: ${cidString}`);

            console.log(`\n=== Step 2: Pin CID ===`);
            await ipfs.testOfflineClient.pinCid(cidString);
            const isPinned = await ipfs.testOfflineClient.isPinned(cidString);
            expect(isPinned).toBe(true);
            console.log(`✅ CID pinned`);

            console.log(`\n=== Step 3: Publish to IPNS ===`);
            const ipnsName = await ipfs.testOfflineClient.publishToIPNS(cidString, { key: integrationKeyName });
            expect(ipnsName).toBe(keyId);
            console.log(`✅ Published to IPNS: ${ipnsName}`);

            console.log(`\n=== Step 4: Resolve IPNS ===`);
            const resolvedPath = await ipfs.testOfflineClient.resolveIPNS(ipnsName);
            expect(resolvedPath).toContain(cidString);
            console.log(`✅ Resolved: ${resolvedPath}`);

            console.log(`\n=== Step 5: Update with new CID ===`);
            const newTestData = new TextEncoder().encode(`Updated lifecycle - ${timestamp}`);
            const newHash = await ipfs.testOfflineClient.hasher.digest(newTestData);
            const newCid = CID.create(1, 0x55, newHash);
            const newCidString = newCid.toString();

            await ipfs.testOfflineClient.putBlock(newCid, newTestData);
            await ipfs.testOfflineClient.pinCid(newCidString);
            console.log(`✅ New CID created and pinned: ${newCidString}`);

            console.log(`\n=== Step 6: Update IPNS ===`);
            const updatedIpnsName = await ipfs.testOfflineClient.publishToIPNS(newCidString, { key: integrationKeyName });
            expect(updatedIpnsName).toBe(ipnsName);
            console.log(`✅ IPNS updated`);

            console.log(`\n=== Step 7: Verify resolution ===`);
            const newResolvedPath = await ipfs.testOfflineClient.resolveIPNS(ipnsName, { nocache: true });
            expect(newResolvedPath).toContain(newCidString);
            console.log(`✅ Resolves to new CID: ${newResolvedPath}`);

            console.log(`\n✅ Full IPNS lifecycle completed successfully`);
        }, 60000); // 60 second timeout for full lifecycle test
    });
});
