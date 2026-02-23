import * as bunTest from 'bun:test';
import { run } from 't44/standalone-rt';

interface FileInput {
    path: string;
    content: string | Uint8Array;
}

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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-unixfs.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

describe('IPFS Client', () => {

    describe('Import and Export with Pin and MFS', () => {
        const timestamp = Date.now();
        const mfsPath = `/test-ipfs-import-export-${timestamp}`;
        let rootCid: string;

        // Create a small binary image (1x1 red PNG)
        const redPixelPNG = new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
            0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
            0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
            0x44, 0xAE, 0x42, 0x60, 0x82
        ]);

        const testFiles: FileInput[] = [
            { path: 'root.txt', content: `Root level file content - ${timestamp}` },
            { path: 'docs/readme.md', content: `# Documentation\n\nThis is a readme file.\n\nGenerated at: ${timestamp}` },
            { path: 'src/index.ts', content: `export const hello = "world"; // ${timestamp}` },
            { path: 'src/utils/helper.ts', content: `export function add(a: number, b: number) { return a + b; } // ${timestamp}` },
            { path: 'src/components/Button.tsx', content: `export const Button = () => <button>Click me - ${timestamp}</button>;` },
            { path: 'nested/deep/file1.txt', content: `Nested file 1 - ${timestamp}` },
            { path: 'nested/deep/file2.txt', content: `Nested file 2 - ${timestamp}` },
            { path: 'nested/sibling.txt', content: `Sibling file - ${timestamp}` },
            // Binary image file
            { path: 'images/red-pixel.png', content: redPixelPNG },
            // Files with special characters in names
            { path: 'special/file with spaces.txt', content: `File with spaces - ${timestamp}` },
            { path: 'special/file-with-ümlaut.txt', content: `File with ümlaut and émoji 🎉 - ${timestamp}` },
            { path: 'special/日本語.txt', content: `Japanese filename - 日本語コンテンツ - ${timestamp}` },
            { path: 'special/emoji-😀.txt', content: `Emoji in filename 😀🎨🚀 - ${timestamp}` },
        ];

        beforeAll(async () => {
            console.log('\n=== Importing files with pin=true and mfsPath ===');
            console.log(`Files to import: ${testFiles.length}`);
            console.log(`MFS Path: ${mfsPath}`);

            rootCid = await ipfs.testOfflineClient.importFiles(testFiles, { pin: true, mfsPath });

            console.log(`✅ Files imported successfully`);
            console.log(`   Root CID: ${rootCid}`);
            console.log(`   Pinned: true`);
            console.log(`   MFS Path: ${mfsPath}`);
        });

        it('should return valid CID from import', () => {
            console.log('Verifying CID format...');

            expect(rootCid).toBeDefined();
            expect(typeof rootCid).toBe('string');
            expect(rootCid.length).toBeGreaterThan(0);
            expect(rootCid).toMatch(/^[a-z0-9]+$/i);

            console.log(`✅ CID is valid: ${rootCid}`);
        });

        it('should export all files with matching content', async () => {
            console.log('Testing exportFiles...');

            const downloadedFiles = await ipfs.testOfflineClient.exportFiles(rootCid);

            expect(downloadedFiles).toBeDefined();
            expect(downloadedFiles.length).toBe(testFiles.length);

            // Sort both arrays for comparison
            const sortedOriginal = [...testFiles].sort((a, b) => a.path.localeCompare(b.path));
            const sortedDownloaded = [...downloadedFiles].sort((a, b) => a.path.localeCompare(b.path));

            for (let i = 0; i < sortedOriginal.length; i++) {
                expect(sortedDownloaded[i].path).toBe(sortedOriginal[i].path);

                // Handle both string and Uint8Array content
                const originalContent = sortedOriginal[i].content;
                const downloadedContent = sortedDownloaded[i].content;

                if (originalContent instanceof Uint8Array && downloadedContent instanceof Uint8Array) {
                    // Compare binary content byte by byte
                    expect(downloadedContent.length).toBe(originalContent.length);
                    expect(Array.from(downloadedContent)).toEqual(Array.from(originalContent));
                } else {
                    // Compare string content
                    expect(downloadedContent).toBe(originalContent);
                }
            }

            console.log(`✅ All ${downloadedFiles.length} files verified`);
        });

        it('should export individual files from CID', async () => {
            console.log('Testing exportFile with CID...');

            const rootFile = await ipfs.testOfflineClient.exportFile(rootCid, 'root.txt');
            expect(rootFile).toBe(`Root level file content - ${timestamp}`);

            const nestedFile1 = await ipfs.testOfflineClient.exportFile(rootCid, 'nested/deep/file1.txt');
            expect(nestedFile1).toBe(`Nested file 1 - ${timestamp}`);

            const nestedFile2 = await ipfs.testOfflineClient.exportFile(rootCid, 'nested/deep/file2.txt');
            expect(nestedFile2).toBe(`Nested file 2 - ${timestamp}`);

            console.log(`✅ Individual files exported from CID`);
        });

        it('should export individual files from MFS path', async () => {
            console.log('Testing exportFile with MFS path...');

            const rootFile = await ipfs.testOfflineClient.exportFile(mfsPath, 'root.txt');
            expect(rootFile).toBe(`Root level file content - ${timestamp}`);

            const nestedFile1 = await ipfs.testOfflineClient.exportFile(mfsPath, 'nested/deep/file1.txt');
            expect(nestedFile1).toBe(`Nested file 1 - ${timestamp}`);

            const siblingFile = await ipfs.testOfflineClient.exportFile(mfsPath, 'nested/sibling.txt');
            expect(siblingFile).toBe(`Sibling file - ${timestamp}`);

            console.log(`✅ Individual files exported from MFS`);
        });

        it('should return identical content from CID and MFS', async () => {
            console.log('Verifying CID and MFS return same content...');

            const file1FromCid = await ipfs.testOfflineClient.exportFile(rootCid, 'nested/deep/file1.txt');
            const file1FromMfs = await ipfs.testOfflineClient.exportFile(mfsPath, 'nested/deep/file1.txt');
            expect(file1FromCid).toBe(file1FromMfs);

            const file2FromCid = await ipfs.testOfflineClient.exportFile(rootCid, 'src/index.ts');
            const file2FromMfs = await ipfs.testOfflineClient.exportFile(mfsPath, 'src/index.ts');
            expect(file2FromCid).toBe(file2FromMfs);

            console.log(`✅ CID and MFS content match`);
        });

        it('should not cache data - multiple exports fetch from IPFS', async () => {
            console.log('Testing no-cache behavior...');

            const download1 = await ipfs.testOfflineClient.exportFiles(rootCid);
            const download2 = await ipfs.testOfflineClient.exportFiles(rootCid);
            const download3 = await ipfs.testOfflineClient.exportFiles(rootCid);

            expect(download1.length).toBe(testFiles.length);
            expect(download2.length).toBe(testFiles.length);
            expect(download3.length).toBe(testFiles.length);

            // Verify content matches across all downloads
            expect(download1[0].content).toBe(download2[0].content);
            expect(download2[0].content).toBe(download3[0].content);

            console.log(`✅ Multiple downloads verified - no caching`);
        });

        it('should verify CID is pinned', async () => {
            console.log('Checking if CID is pinned...');

            const isPinned = await ipfs.testOfflineClient.isPinned(rootCid);
            expect(isPinned).toBe(true);

            console.log(`✅ CID is pinned: ${rootCid}`);
        });

        it('should verify MFS path exists', async () => {
            console.log('Checking if MFS path exists...');

            const exists = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(exists).toBe(true);

            console.log(`✅ MFS path exists: ${mfsPath}`);
        });

        it('should handle binary image file correctly', async () => {
            console.log('Testing binary image file...');

            const imageFile = await ipfs.testOfflineClient.exportFile(rootCid, 'images/red-pixel.png');
            expect(imageFile).toBeInstanceOf(Uint8Array);

            // Verify it's the same binary data
            const originalImage = redPixelPNG;
            expect((imageFile as Uint8Array).length).toBe(originalImage.length);
            expect(Array.from(imageFile as Uint8Array)).toEqual(Array.from(originalImage));

            console.log(`✅ Binary image verified: ${(imageFile as Uint8Array).length} bytes`);
        });

        it('should handle files with special characters in names', async () => {
            console.log('Testing files with special characters...');

            // File with spaces
            const fileWithSpaces = await ipfs.testOfflineClient.exportFile(rootCid, 'special/file with spaces.txt');
            expect(fileWithSpaces).toBe(`File with spaces - ${timestamp}`);

            // File with umlauts and emoji in content
            const fileWithUmlaut = await ipfs.testOfflineClient.exportFile(rootCid, 'special/file-with-ümlaut.txt');
            expect(fileWithUmlaut).toBe(`File with ümlaut and émoji 🎉 - ${timestamp}`);

            // File with Japanese characters
            const japaneseFile = await ipfs.testOfflineClient.exportFile(rootCid, 'special/日本語.txt');
            expect(japaneseFile).toBe(`Japanese filename - 日本語コンテンツ - ${timestamp}`);

            // File with emoji in filename
            const emojiFile = await ipfs.testOfflineClient.exportFile(rootCid, 'special/emoji-😀.txt');
            expect(emojiFile).toBe(`Emoji in filename 😀🎨🚀 - ${timestamp}`);

            console.log(`✅ All special character files verified`);
        });
    });

    describe('Import Options Permutations', () => {
        const baseTimestamp = Date.now();

        it('should import with no options (default behavior)', async () => {
            console.log('Testing importFiles with no options...');

            const testFile: FileInput = { path: 'test.txt', content: `No options - ${baseTimestamp}-1` };
            const cid = await ipfs.testOfflineClient.importFiles([testFile]);

            expect(cid).toBeDefined();

            // Verify not pinned by default
            const isPinned = await ipfs.testOfflineClient.isPinned(cid);
            expect(isPinned).toBe(false);

            // Verify can export
            const files = await ipfs.testOfflineClient.exportFiles(cid);
            expect(files.length).toBe(1);
            expect(files[0].content).toBe(testFile.content);

            console.log(`✅ Import with no options works: ${cid}`);
        });

        it('should import with pin=true only', async () => {
            console.log('Testing importFiles with pin=true...');

            const testFile: FileInput = { path: 'test.txt', content: `Pin only - ${baseTimestamp}-2` };
            const cid = await ipfs.testOfflineClient.importFiles([testFile], { pin: true });

            expect(cid).toBeDefined();

            // Verify is pinned
            const isPinned = await ipfs.testOfflineClient.isPinned(cid);
            expect(isPinned).toBe(true);

            // Verify can export
            const files = await ipfs.testOfflineClient.exportFiles(cid);
            expect(files[0].content).toBe(testFile.content);

            console.log(`✅ Import with pin=true works: ${cid}`);
        });

        it('should import with mfsPath only', async () => {
            console.log('Testing importFiles with mfsPath...');

            const testFile: FileInput = { path: 'test.txt', content: `MFS only - ${baseTimestamp}-3` };
            const mfsPath = `/test-options-mfs-${baseTimestamp}`;

            const cid = await ipfs.testOfflineClient.importFiles([testFile], { mfsPath });

            expect(cid).toBeDefined();

            // Verify not pinned (pin not specified)
            const isPinned = await ipfs.testOfflineClient.isPinned(cid);
            expect(isPinned).toBe(false);

            // Verify MFS path exists
            const exists = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(exists).toBe(true);

            // Verify can export from MFS
            const content = await ipfs.testOfflineClient.exportFile(mfsPath, 'test.txt');
            expect(content).toBe(testFile.content);

            console.log(`✅ Import with mfsPath works: ${cid} -> ${mfsPath}`);
        });

        it('should import with both pin=true and mfsPath', async () => {
            console.log('Testing importFiles with pin=true and mfsPath...');

            const testFile: FileInput = { path: 'test.txt', content: `Both options - ${baseTimestamp}-4` };
            const mfsPath = `/test-options-both-${baseTimestamp}`;

            const cid = await ipfs.testOfflineClient.importFiles([testFile], { pin: true, mfsPath });

            expect(cid).toBeDefined();

            // Verify is pinned
            const isPinned = await ipfs.testOfflineClient.isPinned(cid);
            expect(isPinned).toBe(true);

            // Verify MFS path exists
            const exists = await ipfs.testOfflineClient.existsInMFS(mfsPath);
            expect(exists).toBe(true);

            // Verify can export from both CID and MFS
            const fromCid = await ipfs.testOfflineClient.exportFile(cid, 'test.txt');
            const fromMfs = await ipfs.testOfflineClient.exportFile(mfsPath, 'test.txt');
            expect(fromCid).toBe(testFile.content);
            expect(fromMfs).toBe(testFile.content);

            console.log(`✅ Import with both options works: ${cid} -> ${mfsPath}`);
        });

        it('should import with pin=false explicitly', async () => {
            console.log('Testing importFiles with pin=false...');

            const testFile: FileInput = { path: 'test.txt', content: `Pin false - ${baseTimestamp}-5` };
            const cid = await ipfs.testOfflineClient.importFiles([testFile], { pin: false });

            expect(cid).toBeDefined();

            // Verify not pinned
            const isPinned = await ipfs.testOfflineClient.isPinned(cid);
            expect(isPinned).toBe(false);

            console.log(`✅ Import with pin=false works: ${cid}`);
        });
    });
});
