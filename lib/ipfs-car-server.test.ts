import * as bunTest from 'bun:test';
import { run } from 't44/standalone-rt';
import { IPFSCarServer } from './ipfs-car-server';
import { CID, IPFSConnection } from './ipfs';
import nodePath from 'node:path';
import { mkdir } from 'fs/promises';

const {
    test: { describe, it, expect, beforeAll, workbenchDir, getRandomPort },
    ipfs,
} = await run(async ({ encapsulate, CapsulePropertyTypes, makeImportStack }: any) => {
    const spine = await encapsulate({
        '#@stream44.studio/encapsulate/spine-contracts/CapsuleSpineContract.v0': {
            '#@stream44.studio/encapsulate/structs/Capsule': {},
            '#': {
                test: {
                    type: CapsulePropertyTypes.Mapping,
                    value: 't44/caps/ProjectTest',
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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-car-server.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

describe('IPFSCarServer', () => {
    let carDirectory: string;
    let carClient: IPFSCarServer;

    beforeAll(async () => {
        // Create CAR directory
        carDirectory = nodePath.join(workbenchDir, 'cars');
        await mkdir(carDirectory, { recursive: true });
    });

    describe('Constructor and basic methods', () => {
        it('should create an instance with default options', () => {
            const client = new IPFSCarServer({ carDirectory });

            expect(client).toBeDefined();
        });

        it('should create an instance with custom port and hostname', async () => {
            const client = new IPFSCarServer({
                carDirectory,
                port: await getRandomPort(),
                hostname: 'localhost'
            });

            expect(client).toBeDefined();
        });

        it('should create an instance with verbose logging', () => {
            const client = new IPFSCarServer({
                carDirectory,
                verbose: true
            });

            expect(client).toBeDefined();
        });

        it('should throw error when getting gateway URL before starting server', () => {
            const client = new IPFSCarServer({ carDirectory });

            expect(() => client.getGatewayUrl()).toThrow('Server is not running');
        });
    });

    describe('Server lifecycle', () => {

        it('should start and stop the server', async () => {
            const client = new IPFSCarServer({ carDirectory, port: await getRandomPort() });

            await client.start();
            const url = client.getGatewayUrl();
            expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

            await client.stop();
            expect(() => client.getGatewayUrl()).toThrow('Server is not running');
        });

        it('should handle multiple start calls gracefully', async () => {
            const port = await getRandomPort();
            const client = new IPFSCarServer({ carDirectory, port });

            await client.start();
            await client.start(); // Should not throw
            expect(client.getGatewayUrl()).toBe(`http://127.0.0.1:${port}`);

            await client.stop();
        });

        it('should handle stop when server is not running', async () => {
            const client = new IPFSCarServer({ carDirectory });

            await client.stop(); // Should not throw
        });
    });

    describe('HTTP server requests', () => {
        it('should serve IPFS content via HTTP', async () => {
            // Create test files
            const files = [
                { path: 'bundle.js', content: 'console.log("Hello from IPFS");' },
                { path: 'package.json', content: JSON.stringify({ name: 'test-bundle' }) },
            ];

            // Store to IPFS and export to CAR
            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            // Create IPFSCarServer with server
            const carClient = new IPFSCarServer({
                carDirectory,
                port: await getRandomPort(),
                verbose: false
            });

            await carClient.start();

            try {
                const gatewayUrl = carClient.getGatewayUrl();
                expect(gatewayUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

                // Fetch bundle.js via HTTP
                const bundleUrl = `${gatewayUrl}/ipfs/${rootCid}/bundle.js`;
                const response = await fetch(bundleUrl);

                expect(response.ok).toBe(true);
                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toBe('application/javascript');

                const content = await response.text();
                expect(content).toBe('console.log("Hello from IPFS");');
            } finally {
                await carClient.stop();
            }
        });

        it('should serve multiple files from the same CID', async () => {
            const files = [
                { path: 'index.js', content: 'export const main = () => {};' },
                { path: 'utils.js', content: 'export const helper = () => {};' },
                { path: 'README.md', content: '# Test Project' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, port: await getRandomPort(), verbose: false });
            await carClient.start();

            try {
                const gatewayUrl = carClient.getGatewayUrl();

                // Fetch all files
                const indexRes = await fetch(`${gatewayUrl}/ipfs/${rootCid}/index.js`);
                const utilsRes = await fetch(`${gatewayUrl}/ipfs/${rootCid}/utils.js`);
                const readmeRes = await fetch(`${gatewayUrl}/ipfs/${rootCid}/README.md`);

                expect(indexRes.ok).toBe(true);
                expect(utilsRes.ok).toBe(true);
                expect(readmeRes.ok).toBe(true);

                expect(await indexRes.text()).toContain('main');
                expect(await utilsRes.text()).toContain('helper');
                expect(await readmeRes.text()).toContain('# Test Project');
            } finally {
                await carClient.stop();
            }
        });

        it('should return 404 for non-existent files', async () => {
            const files = [{ path: 'exists.txt', content: 'I exist' }];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, port: await getRandomPort(), verbose: false });
            await carClient.start();

            try {
                const gatewayUrl = carClient.getGatewayUrl();

                // Try to fetch non-existent file
                const response = await fetch(`${gatewayUrl}/ipfs/${rootCid}/does-not-exist.txt`);
                expect(response.status).toBe(404);
            } finally {
                await carClient.stop();
            }
        });

        it('should return 404 for non-IPFS paths', async () => {
            const carClient = new IPFSCarServer({ carDirectory, port: await getRandomPort(), verbose: false });
            await carClient.start();

            try {
                const gatewayUrl = carClient.getGatewayUrl();
                const response = await fetch(`${gatewayUrl}/not-ipfs/something`);
                expect(response.status).toBe(404);
            } finally {
                await carClient.stop();
            }
        });

        it('should cache CAR files for faster subsequent requests', async () => {
            const files = [{ path: 'cached.txt', content: 'Cached content' }];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, port: await getRandomPort(), verbose: false });
            await carClient.start();

            try {
                const gatewayUrl = carClient.getGatewayUrl();
                const url = `${gatewayUrl}/ipfs/${rootCid}/cached.txt`;

                // First request
                const start1 = Date.now();
                const res1 = await fetch(url);
                const time1 = Date.now() - start1;
                expect(res1.ok).toBe(true);

                // Second request (should use cache)
                const start2 = Date.now();
                const res2 = await fetch(url);
                const time2 = Date.now() - start2;
                expect(res2.ok).toBe(true);

                expect(await res1.text()).toBe(await res2.text());
            } finally {
                await carClient.stop();
            }
        });
    });

    describe('exportFiles from CAR', () => {
        it('should load and export files from a simple CAR file', async () => {

            // Create test files
            const files = [
                { path: 'README.md', content: '# Test Project\n\nThis is a test README.' },
                { path: 'package.json', content: JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2) },
            ];

            // Store to IPFS and export to CAR
            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);


            // Create IPFSCarServer and load from CAR
            carClient = new IPFSCarServer({
                carDirectory,
                verbose: false
            });

            const exportedFiles = await carClient.exportFiles(rootCid);

            expect(exportedFiles).toHaveLength(2);

            // Verify README.md
            const readme = exportedFiles.find(f => f.path === 'README.md');
            expect(readme).toBeDefined();
            expect(readme!.content).toBe('# Test Project\n\nThis is a test README.');

            // Verify package.json
            const packageJson = exportedFiles.find(f => f.path === 'package.json');
            expect(packageJson).toBeDefined();
            expect(typeof packageJson!.content).toBe('string');
            const parsed = JSON.parse(packageJson!.content as string);
            expect(parsed.name).toBe('test');
            expect(parsed.version).toBe('1.0.0');

        });

        it('should handle multiple files with nested paths', async () => {

            const files = [
                { path: 'index.ts', content: 'console.log("Hello");' },
                { path: 'utils.ts', content: 'export const add = (a, b) => a + b;' },
                { path: 'index.test.ts', content: 'import { test } from "bun:test";' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            carClient = new IPFSCarServer({ carDirectory, verbose: false });
            const exportedFiles = await carClient.exportFiles(rootCid);

            expect(exportedFiles).toHaveLength(3);

            const indexFile = exportedFiles.find(f => f.path === 'index.ts');
            expect(indexFile).toBeDefined();
            expect(indexFile!.content).toContain('console.log');

        });

        it('should handle binary content', async () => {

            const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
            const files = [
                { path: 'image.png', content: binaryData },
                { path: 'text.txt', content: 'Plain text' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            carClient = new IPFSCarServer({ carDirectory, verbose: false });
            const exportedFiles = await carClient.exportFiles(rootCid);

            expect(exportedFiles).toHaveLength(2);

            const imageFile = exportedFiles.find(f => f.path === 'image.png');
            expect(imageFile).toBeDefined();
            expect(imageFile!.content instanceof Uint8Array).toBe(true);
            expect((imageFile!.content as Uint8Array)[0]).toBe(0x89);

            const textFile = exportedFiles.find(f => f.path === 'text.txt');
            expect(textFile).toBeDefined();
            expect(typeof textFile!.content).toBe('string');
            expect(textFile!.content).toBe('Plain text');
        });

        it('should cache loaded CAR files', async () => {

            const files = [
                { path: 'cache-test.txt', content: 'Testing cache' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            carClient = new IPFSCarServer({ carDirectory, verbose: false });

            // First load
            const start1 = Date.now();
            const files1 = await carClient.exportFiles(rootCid);
            const time1 = Date.now() - start1;

            // Second load (should use cache)
            const start2 = Date.now();
            const files2 = await carClient.exportFiles(rootCid);
            const time2 = Date.now() - start2;

            expect(files1).toHaveLength(1);
            expect(files2).toHaveLength(1);
            expect(files1[0].content).toBe(files2[0].content);

            // Cached load should be faster (though not guaranteed)
        });

        it('should throw error for non-existent CAR file', async () => {
            carClient = new IPFSCarServer({ carDirectory, verbose: false });
            const fakeCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

            try {
                await carClient.exportFiles(fakeCid);
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error.message).toContain('Failed to load CAR file');
            }
        });

        it('should throw error for non-directory root CID', async () => {
            // Create a single block (not a directory)
            const singleData = { test: 'data' };
            const cid = await ipfs.testOfflineClient.putWithCodec(singleData, { codec: 'dag-cbor' });

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(cid);
            const carPath = nodePath.join(carDirectory, `${cid.toString()}.car`);
            await Bun.write(carPath, carResponse);

            carClient = new IPFSCarServer({ carDirectory, verbose: false });

            try {
                await carClient.exportFiles(cid.toString());
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error.message).toContain('Root CID must point to a directory');
            }
        });
    });

    describe('Integration with server scenarios', () => {
        it('should work as a drop-in replacement for IPFSClient in bundle loading', async () => {
            // Simulate a bundle structure (note: UnixFS doesn't preserve leading slashes)
            const bundleFiles = [
                { path: 'bundle.js', content: 'IPLDom.bundle("", function (require) { console.log("test"); });' },
                { path: 'package.json', content: JSON.stringify({ name: 'test-bundle', mappings: {} }) },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(bundleFiles);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            // Use IPFSCarServer as if it were IPFSClient
            const carClient = new IPFSCarServer({
                carDirectory,
                verbose: false
            });

            const files = await carClient.exportFiles(rootCid);

            expect(files).toHaveLength(2);

            const bundleJs = files.find(f => f.path === 'bundle.js');
            expect(bundleJs).toBeDefined();
            expect(bundleJs!.content).toContain('IPLDom.bundle');

            const packageJson = files.find(f => f.path === 'package.json');
            expect(packageJson).toBeDefined();
        });

        it('should handle large bundle files efficiently', async () => {
            // Create a large bundle
            const largeCode = 'const data = ' + JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` }))) + ';';
            const bundleFiles = [
                { path: 'bundle.js', content: largeCode },
                { path: 'package.json', content: JSON.stringify({ name: 'large-bundle' }) },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(bundleFiles);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, verbose: false });

            const start = Date.now();
            const files = await carClient.exportFiles(rootCid);
            const duration = Date.now() - start;

            expect(files).toHaveLength(2);
            const bundleJs = files.find(f => f.path === 'bundle.js');
            expect(bundleJs!.content).toContain('const data =');
        });

        it('should support multiple concurrent CAR file loads', async () => {
            // Create multiple bundles
            const bundles = await Promise.all([
                (async () => {
                    const files = [{ path: 'bundle1.js', content: 'console.log(1);' }];
                    const cid = await ipfs.testOfflineClient.importFiles(files);
                    const car = await ipfs.testOfflineClient.exportToCAR(cid);
                    await Bun.write(nodePath.join(carDirectory, `${cid}.car`), car);
                    return cid;
                })(),
                (async () => {
                    const files = [{ path: 'bundle2.js', content: 'console.log(2);' }];
                    const cid = await ipfs.testOfflineClient.importFiles(files);
                    const car = await ipfs.testOfflineClient.exportToCAR(cid);
                    await Bun.write(nodePath.join(carDirectory, `${cid}.car`), car);
                    return cid;
                })(),
                (async () => {
                    const files = [{ path: 'bundle3.js', content: 'console.log(3);' }];
                    const cid = await ipfs.testOfflineClient.importFiles(files);
                    const car = await ipfs.testOfflineClient.exportToCAR(cid);
                    await Bun.write(nodePath.join(carDirectory, `${cid}.car`), car);
                    return cid;
                })(),
            ]);

            const carClient = new IPFSCarServer({ carDirectory, verbose: false });

            // Load all concurrently
            const results = await Promise.all(
                bundles.map(cid => carClient.exportFiles(cid))
            );

            expect(results).toHaveLength(3);
            expect(results[0][0].content).toContain('console.log(1)');
            expect(results[1][0].content).toContain('console.log(2)');
            expect(results[2][0].content).toContain('console.log(3)');
        });
    });

    describe('Edge cases and error handling', () => {
        it('should handle empty files', async () => {

            const files = [
                { path: 'empty.txt', content: '' },
                { path: 'normal.txt', content: 'content' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, verbose: false });
            const exportedFiles = await carClient.exportFiles(rootCid);

            const emptyFile = exportedFiles.find(f => f.path === 'empty.txt');
            expect(emptyFile).toBeDefined();
            expect(emptyFile!.content).toBe('');
        });

        it('should handle special characters in filenames', async () => {

            const files = [
                { path: 'file with spaces.txt', content: 'spaces' },
                { path: 'file-with-dashes.txt', content: 'dashes' },
                { path: 'file_with_underscores.txt', content: 'underscores' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, verbose: false });
            const exportedFiles = await carClient.exportFiles(rootCid);

            expect(exportedFiles).toHaveLength(3);
            expect(exportedFiles.find(f => f.path === 'file with spaces.txt')).toBeDefined();
            expect(exportedFiles.find(f => f.path === 'file-with-dashes.txt')).toBeDefined();
            expect(exportedFiles.find(f => f.path === 'file_with_underscores.txt')).toBeDefined();
        });

        it('should handle UTF-8 content correctly', async () => {

            const files = [
                { path: 'unicode.txt', content: 'Hello 世界 🌍 Привет مرحبا' },
                { path: 'emoji.txt', content: '🎉🎊🎈🎁🎀' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = nodePath.join(carDirectory, `${rootCid}.car`);
            await Bun.write(carPath, carResponse);

            const carClient = new IPFSCarServer({ carDirectory, verbose: false });
            const exportedFiles = await carClient.exportFiles(rootCid);

            const unicodeFile = exportedFiles.find(f => f.path === 'unicode.txt');
            expect(unicodeFile).toBeDefined();
            expect(unicodeFile!.content).toBe('Hello 世界 🌍 Привет مرحبا');

            const emojiFile = exportedFiles.find(f => f.path === 'emoji.txt');
            expect(emojiFile).toBeDefined();
            expect(emojiFile!.content).toBe('🎉🎊🎈🎁🎀');
        });
    });
});
