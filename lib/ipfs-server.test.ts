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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-server.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});


describe('IPFSServer - Server Operations', () => {

    describe('IPNS Key Import/Export', () => {
        const exportKeyName = `test-server-export-key-${Date.now()}`;
        const importKeyName = `test-server-import-key-${Date.now()}`;
        let exportedKeyPem: string;
        let originalKeyId: string;

        it('should generate a key and export it using server', async () => {
            console.log('Generating key and exporting via server...');

            // Generate a key using IPFS client
            const keyInfo = await ipfs.testOfflineClient.generateIPNSKey(exportKeyName);
            originalKeyId = keyInfo.Id;

            console.log(`✅ Generated IPNS key: ${keyInfo.Name} (${keyInfo.Id})`);

            // Export the key in PEM format using server
            exportedKeyPem = await (await ipfs.testOfflineServer).exportIPNSKey(exportKeyName);

            expect(exportedKeyPem).toBeDefined();
            expect(typeof exportedKeyPem).toBe('string');
            expect(exportedKeyPem.length).toBeGreaterThan(0);
            expect(exportedKeyPem).toContain('BEGIN PRIVATE KEY');
            expect(exportedKeyPem).toContain('END PRIVATE KEY');

            console.log(`✅ Exported key via server: ${exportedKeyPem.length} chars (PEM format)`);
        });

        it('should import a key from exported PEM using server', async () => {
            console.log('Testing IPNS key import via server...');

            const result = await (await ipfs.testOfflineServer).importIPNSKey(importKeyName, exportedKeyPem);

            expect(result).toBeDefined();
            expect(result.Name).toBe(importKeyName);
            expect(result.Id).toBeDefined();
            expect(typeof result.Id).toBe('string');
            expect(result.Id.length).toBeGreaterThan(0);

            console.log(`✅ Imported IPNS key via server: ${result.Name} (${result.Id})`);
            console.log(`   Original key ID: ${originalKeyId}, Imported key ID: ${result.Id}`);
        });

        it('should verify imported key is in keystore', async () => {
            console.log('Verifying imported key is in keystore...');

            const keys = await (await ipfs.testOfflineServer).listIPNSKeys();
            const importedKey = keys.find(k => k.Name === importKeyName);

            expect(importedKey).toBeDefined();
            expect(importedKey?.Id).toBeDefined();
            expect(importedKey?.Id.length).toBeGreaterThan(0);

            console.log(`✅ Imported key found in keystore: ${importedKey?.Name} (${importedKey?.Id})`);
        });

        it('should be able to publish with imported key', async () => {
            console.log('Testing IPNS publish with imported key...');

            // Create a test CID
            const testData = new TextEncoder().encode(`Server import test data - ${Date.now()}`);
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
                await (await ipfs.testOfflineServer).importIPNSKey(importKeyName, exportedKeyPem);
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error).toBeDefined();
                expect(error.message).toContain('Failed to import IPNS key');
                console.log(`✅ Correctly rejected duplicate key name: ${error.message}`);
            }
        });
    });

    describe('Server Key Listing', () => {
        it('should list IPNS keys via server', async () => {
            console.log('Testing IPNS key listing via server...');

            const keys = await (await ipfs.testOfflineServer).listIPNSKeys();

            expect(keys).toBeDefined();
            expect(Array.isArray(keys)).toBe(true);
            expect(keys.length).toBeGreaterThan(0);

            console.log(`✅ Found ${keys.length} IPNS keys via server`);
        });
    });

    describe('Server Configuration', () => {
        it('should return the configured repo path', async () => {
            console.log('Testing getRepoPath...');

            const repoPath = (await ipfs.testOfflineServer).getRepoPath();

            expect(repoPath).toBeDefined();
            expect(typeof repoPath).toBe('string');
            expect(repoPath.length).toBeGreaterThan(0);
            expect(repoPath).toContain('.~ipldom-ipfs-test-offline');

            console.log(`✅ Repo path: ${repoPath}`);
        });
    });

    describe('Daemon Management', () => {
        it('should check if daemon is running', async () => {
            console.log('Testing isRunning...');

            const isRunning = await (await ipfs.testOfflineServer).isRunning();

            expect(typeof isRunning).toBe('boolean');
            expect(isRunning).toBe(true); // Should be running from test harness setup

            console.log(`✅ Daemon running status: ${isRunning}`);
        });

        it('should handle ensureStopped when offline test daemon is running', async () => {
            // Skip this test in parallel mode to avoid stopping the shared daemon
            if (process.env.WORKSPACE_KEEP_IPFS_DATA) {
                console.log('⏭️  Skipping ensureStopped test: WORKSPACE_KEEP_IPFS_DATA is set (parallel mode)');
                return;
            }

            console.log('Testing ensureStopped (daemon should restart after)...');

            // This will stop the daemon
            await (await ipfs.testOfflineServer).ensureStopped();

            const isRunning = await (await ipfs.testOfflineServer).isRunning();
            expect(isRunning).toBe(false);
            console.log('✅ Daemon stopped successfully');

            // Restart for other tests
            await (await ipfs.testOfflineServer).start({ offline: true });
            const isRunningAgain = await (await ipfs.testOfflineServer).isRunning();
            expect(isRunningAgain).toBe(true);
            console.log('✅ Daemon restarted successfully');
        });

        // NOTE: ensurePeeredWith() requires a live remote gateway and is tested
        // in integration tests with actual network connectivity. It cannot be
        // tested in offline mode used by this test suite.
    });

    describe('IPNS Key Management - ensureIPNSKey', () => {
        const ensureKeyName = `test-ensure-key-${Date.now()}`;

        it('should generate and cache a new IPNS key', async () => {
            console.log('Testing ensureIPNSKey with new key...');

            const keyInfo = await (await ipfs.testOfflineServer).ensureIPNSKey(ensureKeyName);

            expect(keyInfo).toBeDefined();
            expect(keyInfo.Name).toBe(ensureKeyName);
            expect(keyInfo.Id).toBeDefined();
            expect(keyInfo.Id.length).toBeGreaterThan(0);

            console.log(`✅ Ensured IPNS key: ${keyInfo.Name} (${keyInfo.Id})`);
        });

        it('should reuse cached IPNS key on subsequent calls', async () => {
            console.log('Testing ensureIPNSKey with existing key...');

            // Call again with same name
            const keyInfo = await (await ipfs.testOfflineServer).ensureIPNSKey(ensureKeyName);

            expect(keyInfo).toBeDefined();
            expect(keyInfo.Name).toBe(ensureKeyName);
            expect(keyInfo.Id).toBeDefined();

            console.log(`✅ Reused cached IPNS key: ${keyInfo.Name} (${keyInfo.Id})`);
        });
    });

    describe('Integration: Server Export/Import Workflow', () => {
        it('should support full export/import lifecycle', async () => {
            console.log('Testing full server export/import lifecycle...');

            const timestamp = Date.now();
            const keyName1 = `test-lifecycle-1-${timestamp}`;
            const keyName2 = `test-lifecycle-2-${timestamp}`;

            console.log(`\n=== Step 1: Generate key ===`);
            const keyInfo = await ipfs.testOfflineClient.generateIPNSKey(keyName1);
            console.log(`✅ Generated key: ${keyInfo.Name} (${keyInfo.Id})`);

            console.log(`\n=== Step 2: Export key via server ===`);
            const exportedPem = await (await ipfs.testOfflineServer).exportIPNSKey(keyName1);
            expect(exportedPem).toBeDefined();
            expect(exportedPem.length).toBeGreaterThan(0);
            console.log(`✅ Exported key: ${exportedPem.length} chars`);

            console.log(`\n=== Step 3: Import key with new name via server ===`);
            const importedKeyInfo = await (await ipfs.testOfflineServer).importIPNSKey(keyName2, exportedPem);
            expect(importedKeyInfo.Name).toBe(keyName2);
            console.log(`✅ Imported key: ${importedKeyInfo.Name} (${importedKeyInfo.Id})`);

            console.log(`\n=== Step 4: Verify both keys exist ===`);
            const keys = await (await ipfs.testOfflineServer).listIPNSKeys();
            const key1 = keys.find(k => k.Name === keyName1);
            const key2 = keys.find(k => k.Name === keyName2);
            expect(key1).toBeDefined();
            expect(key2).toBeDefined();
            console.log(`✅ Both keys found in keystore`);

            console.log(`\n✅ Full server lifecycle completed successfully`);
        });
    });

});
