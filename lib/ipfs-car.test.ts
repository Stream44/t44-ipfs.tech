import * as bunTest from 'bun:test';
import { run } from 't44/standalone-rt';
import { CarReader } from '@ipld/car';
import { CID } from './ipfs';
import path from 'node:path';

const {
    test: { describe, it, expect, workbenchDir },
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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-car.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

/**
 * CAR file summary for verification
 */
interface CARSummary {
    roots: string[];
    blockCount: number;
    totalSize: number;
    cids: string[];
    codecCounts: Record<string, number>;
}

/**
 * Inspect a CAR file and return a summary without importing to IPFS
 */
async function inspectCAR(carPath: string): Promise<CARSummary> {
    const file = Bun.file(carPath);
    const carBytes = new Uint8Array(await file.arrayBuffer());
    const reader = await CarReader.fromBytes(carBytes);

    const roots = await reader.getRoots();
    const cids: string[] = [];
    const codecCounts: Record<string, number> = {};
    let totalSize = 0;
    let blockCount = 0;

    for await (const { cid, bytes } of reader.blocks()) {
        blockCount++;
        totalSize += bytes.length;
        cids.push(cid.toString());

        const codecName = getCodecName(cid.code);
        codecCounts[codecName] = (codecCounts[codecName] || 0) + 1;
    }

    return {
        roots: roots.map(r => r.toString()),
        blockCount,
        totalSize,
        cids,
        codecCounts,
    };
}

function getCodecName(code: number): string {
    const names: Record<number, string> = {
        0x55: 'raw',
        0x70: 'dag-pb',
        0x71: 'dag-cbor',
        0x0129: 'dag-json',
    };
    return names[code] || `unknown-0x${code.toString(16)}`;
}

describe('IPFSClient - CAR File Support', () => {

    describe('exportToCAR', () => {
        it('should export a simple dag-cbor block to CAR', async () => {
            console.log('Testing CAR export with dag-cbor...');

            const testData = {
                name: 'Test Project',
                version: '1.0.0',
                description: 'A test project for CAR export',
            };

            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'dag-cbor' });
            console.log(`Stored test data: ${cid.toString()}`);

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(cid);
            const carPath = path.join(workbenchDir, 'test-cbor.car');
            await Bun.write(carPath, carResponse);

            // Inspect CAR file
            const summary = await inspectCAR(carPath);

            expect(summary.roots).toEqual([cid.toString()]);
            expect(summary.blockCount).toBe(1);
            expect(summary.codecCounts['dag-cbor']).toBe(1);
            expect(summary.totalSize).toBeGreaterThan(0);

            console.log(`✅ CAR verified: ${summary.blockCount} blocks, ${summary.totalSize} bytes`);
        });

        it('should export a DAG with multiple blocks to CAR', async () => {
            console.log('Testing CAR export with linked blocks...');

            const childData = { content: 'Child block content', timestamp: Date.now() };
            const childCid = await ipfs.testOfflineClient.putWithCodec(childData, { codec: 'dag-cbor' });

            const parentData = {
                name: 'Parent block',
                child: childCid,
                metadata: { created: Date.now() },
            };
            const parentCid = await ipfs.testOfflineClient.putWithCodec(parentData, { codec: 'dag-cbor' });

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(parentCid);
            const carPath = path.join(workbenchDir, 'test-linked.car');
            await Bun.write(carPath, carResponse);

            // Inspect CAR file
            const summary = await inspectCAR(carPath);

            expect(summary.roots).toEqual([parentCid.toString()]);
            expect(summary.blockCount).toBe(2); // parent + child
            expect(summary.cids).toContain(parentCid.toString());
            expect(summary.cids).toContain(childCid.toString());
            expect(summary.codecCounts['dag-cbor']).toBe(2);

            console.log(`✅ CAR verified: ${summary.blockCount} blocks`);
        });

        it('should export UnixFS files to CAR', async () => {
            console.log('Testing CAR export with UnixFS files...');

            const files = [
                { path: 'README.md', content: '# Test Project\n\nThis is a test.' },
                { path: 'src/index.ts', content: 'console.log("Hello, CAR!");' },
            ];

            const rootCid = await ipfs.testOfflineClient.importFiles(files);

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(rootCid);
            const carPath = path.join(workbenchDir, 'test-unixfs.car');
            await Bun.write(carPath, carResponse);

            // Inspect CAR file
            const summary = await inspectCAR(carPath);

            expect(summary.roots).toEqual([rootCid]);
            expect(summary.blockCount).toBeGreaterThan(2); // root + files + chunks
            expect(summary.codecCounts['dag-pb']).toBeGreaterThan(0); // UnixFS uses dag-pb

            console.log(`✅ CAR verified: ${summary.blockCount} blocks, codecs: ${JSON.stringify(summary.codecCounts)}`);
        });

        it('should handle raw codec blocks', async () => {
            console.log('Testing CAR export with raw codec...');

            const rawData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            const cid = await ipfs.testOfflineClient.putWithCodec(rawData, { codec: 'raw' });

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(cid);
            const carPath = path.join(workbenchDir, 'test-raw.car');
            await Bun.write(carPath, carResponse);

            // Inspect CAR file
            const summary = await inspectCAR(carPath);

            expect(summary.roots).toEqual([cid.toString()]);
            expect(summary.blockCount).toBe(1);
            expect(summary.codecCounts['raw']).toBe(1);

            console.log(`✅ CAR verified: raw codec block`);
        });
    });

    describe('importFromCAR', () => {
        it('should import a CAR file with guaranteed new content', async () => {
            console.log('Testing CAR import with truly new content...');

            // Create CAR file directly without using IPFS first
            const { CarWriter } = await import('@ipld/car');
            const { encode } = await import('@ipld/dag-cbor');
            const { CID } = await import('multiformats/cid');
            const { sha256 } = await import('multiformats/hashes/sha2');

            // Create unique data
            const uniqueData = {
                id: `import-test-${Date.now()}`,
                timestamp: Date.now(),
                random: Math.random(),
            };

            // Encode and create CID manually (not using IPFS)
            const bytes = encode(uniqueData);
            const hash = await ipfs.testOfflineClient.hasher.digest(bytes);
            const cid = CID.create(1, 0x71, hash); // dag-cbor

            // Create CAR file directly
            const { writer, out } = CarWriter.create([cid]);
            const chunks: Uint8Array[] = [];
            const collectPromise = (async () => {
                for await (const chunk of out) {
                    chunks.push(chunk);
                }
            })();

            await writer.put({ cid, bytes });
            await writer.close();
            await collectPromise;

            // Write CAR file
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const carBytes = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                carBytes.set(chunk, offset);
                offset += chunk.length;
            }

            const carPath = path.join(workbenchDir, 'test-import-new.car');
            await Bun.write(carPath, carBytes);

            // Verify CAR structure before import
            const beforeSummary = await inspectCAR(carPath);
            expect(beforeSummary.roots).toEqual([cid.toString()]);
            expect(beforeSummary.blockCount).toBe(1);
            console.log(`CAR created with ${beforeSummary.blockCount} block(s), CID: ${cid.toString()}`);

            // NOW import to IPFS (first time IPFS sees this data)
            const file = Bun.file(carPath);
            const roots = await ipfs.testOfflineClient.importFromCAR(file.stream());

            expect(roots).toHaveLength(1);
            expect(roots[0].toString()).toBe(cid.toString());

            // Verify data is now accessible in IPFS
            const retrieved = await ipfs.testOfflineClient.getWithCodec(roots[0]);
            expect(retrieved).toEqual(uniqueData);

            console.log('✅ CAR import successful - data was truly new to IPFS');
        });

        it('should import from Uint8Array', async () => {
            console.log('Testing CAR import from Uint8Array...');

            const uniqueData = { id: `bytes-${Date.now()}`, value: Math.random() };
            const cid = await ipfs.testOfflineClient.putWithCodec(uniqueData, { codec: 'dag-cbor' });

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(cid);
            const carPath = path.join(workbenchDir, 'test-bytes.car');
            await Bun.write(carPath, carResponse);

            // Read as Uint8Array
            const file = Bun.file(carPath);
            const carBytes = new Uint8Array(await file.arrayBuffer());

            // Import from bytes
            const roots = await ipfs.testOfflineClient.importFromCAR(carBytes);

            expect(roots).toHaveLength(1);
            expect(roots[0].toString()).toBe(cid.toString());

            const retrieved = await ipfs.testOfflineClient.getWithCodec(roots[0]);
            expect(retrieved).toEqual(uniqueData);

            console.log('✅ Import from Uint8Array successful');
        });

        it('should import multi-block DAG structure', async () => {
            console.log('Testing CAR import with multi-block DAG...');

            // Create CAR file directly with linked blocks
            const { CarWriter } = await import('@ipld/car');
            const { encode } = await import('@ipld/dag-cbor');
            const { CID } = await import('multiformats/cid');
            const { sha256 } = await import('multiformats/hashes/sha2');

            const timestamp = Date.now();

            // Create leaf blocks
            const leaf1 = { id: `leaf1-${timestamp}`, value: 'A' };
            const leaf2 = { id: `leaf2-${timestamp}`, value: 'B' };

            const leaf1Bytes = encode(leaf1);
            const leaf1Hash = await ipfs.testOfflineClient.hasher.digest(leaf1Bytes);
            const leaf1Cid = CID.create(1, 0x71, leaf1Hash);

            const leaf2Bytes = encode(leaf2);
            const leaf2Hash = await ipfs.testOfflineClient.hasher.digest(leaf2Bytes);
            const leaf2Cid = CID.create(1, 0x71, leaf2Hash);

            // Create root block that links to leaves
            const root = {
                id: `root-${timestamp}`,
                left: leaf1Cid,
                right: leaf2Cid,
            };

            const rootBytes = encode(root);
            const rootHash = await ipfs.testOfflineClient.hasher.digest(rootBytes);
            const rootCid = CID.create(1, 0x71, rootHash);

            // Create CAR file with all blocks
            const { writer, out } = CarWriter.create([rootCid]);
            const chunks: Uint8Array[] = [];
            const collectPromise = (async () => {
                for await (const chunk of out) {
                    chunks.push(chunk);
                }
            })();

            await writer.put({ cid: rootCid, bytes: rootBytes });
            await writer.put({ cid: leaf1Cid, bytes: leaf1Bytes });
            await writer.put({ cid: leaf2Cid, bytes: leaf2Bytes });
            await writer.close();
            await collectPromise;

            // Write CAR file
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const carBytes = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                carBytes.set(chunk, offset);
                offset += chunk.length;
            }

            const carPath = path.join(workbenchDir, 'test-multiblock.car');
            await Bun.write(carPath, carBytes);

            // Verify CAR structure before import
            const summary = await inspectCAR(carPath);
            expect(summary.roots).toEqual([rootCid.toString()]);
            expect(summary.blockCount).toBe(3); // root + 2 leaves
            expect(summary.cids).toContain(rootCid.toString());
            expect(summary.cids).toContain(leaf1Cid.toString());
            expect(summary.cids).toContain(leaf2Cid.toString());
            console.log(`CAR created with ${summary.blockCount} blocks`);

            // NOW import to IPFS (first time IPFS sees this data)
            const file = Bun.file(carPath);
            const roots = await ipfs.testOfflineClient.importFromCAR(file.stream());

            expect(roots[0].toString()).toBe(rootCid.toString());

            // Verify all blocks are now accessible in IPFS
            const retrievedRoot = await ipfs.testOfflineClient.getWithCodec(roots[0]);
            const retrievedLeaf1 = await ipfs.testOfflineClient.getWithCodec(retrievedRoot.left);
            const retrievedLeaf2 = await ipfs.testOfflineClient.getWithCodec(retrievedRoot.right);

            expect(retrievedLeaf1.value).toBe('A');
            expect(retrievedLeaf2.value).toBe('B');

            console.log('✅ Multi-block DAG fully restored - all blocks were new to IPFS');
        });
    });

    describe('Round-trip export/import', () => {
        it('should preserve data integrity through export/import cycle', async () => {
            console.log('Testing round-trip export/import...');

            const uniqueData = {
                id: `roundtrip-${Date.now()}`,
                nested: { deep: { value: 'test', array: [1, 2, 3] } },
            };

            const originalCid = await ipfs.testOfflineClient.putWithCodec(uniqueData, { codec: 'dag-cbor' });

            // Export to CAR
            const carResponse = await ipfs.testOfflineClient.exportToCAR(originalCid);
            const carPath = path.join(workbenchDir, 'test-roundtrip.car');
            await Bun.write(carPath, carResponse);

            // Verify CAR structure
            const summary = await inspectCAR(carPath);
            expect(summary.roots).toEqual([originalCid.toString()]);
            expect(summary.blockCount).toBe(1);

            // Import from CAR
            const file = Bun.file(carPath);
            const roots = await ipfs.testOfflineClient.importFromCAR(file.stream());

            expect(roots[0].toString()).toBe(originalCid.toString());

            // Verify data integrity
            const retrieved = await ipfs.testOfflineClient.getWithCodec(roots[0]);
            expect(retrieved).toEqual(uniqueData);

            console.log('✅ Round-trip successful, data integrity preserved');
        });
    });

    describe('Incremental export', () => {
        it('should export only new blocks when baselineCid is provided', async () => {
            console.log('Testing incremental CAR export...');

            // Create version 1
            const v1Data = {
                name: 'Project',
                version: '1.0.0',
                description: 'Original version',
            };
            const v1Cid = await ipfs.testOfflineClient.putWithCodec(v1Data, { codec: 'dag-cbor' });
            console.log(`Version 1 CID: ${v1Cid.toString()}`);

            // Create version 2 (with reference to v1)
            const v2Data = {
                name: 'Project',
                version: '2.0.0',
                description: 'Updated version',
                previous: v1Cid, // Link to v1
            };
            const v2Cid = await ipfs.testOfflineClient.putWithCodec(v2Data, { codec: 'dag-cbor' });
            console.log(`Version 2 CID: ${v2Cid.toString()}`);

            // Export v1 (full)
            const v1Response = await ipfs.testOfflineClient.exportToCAR(v1Cid);
            const v1Path = path.join(workbenchDir, 'test-v1-full.car');
            await Bun.write(v1Path, v1Response);
            const v1Size = Bun.file(v1Path).size;
            console.log(`V1 full CAR size: ${v1Size} bytes`);

            // Export v2 (full)
            const v2FullResponse = await ipfs.testOfflineClient.exportToCAR(v2Cid);
            const v2FullPath = path.join(workbenchDir, 'test-v2-full.car');
            await Bun.write(v2FullPath, v2FullResponse);
            const v2FullSize = Bun.file(v2FullPath).size;
            console.log(`V2 full CAR size: ${v2FullSize} bytes`);

            // Export v2 incrementally (only blocks not in v1)
            const v2IncrementalResponse = await ipfs.testOfflineClient.exportToCAR(v2Cid, { baselineCid: v1Cid });
            const v2IncrementalPath = path.join(workbenchDir, 'test-v2-incremental.car');
            await Bun.write(v2IncrementalPath, v2IncrementalResponse);

            // Verify incremental CAR structure
            const v2FullSummary = await inspectCAR(v2FullPath);
            const v2IncrementalSummary = await inspectCAR(v2IncrementalPath);

            expect(v2FullSummary.blockCount).toBe(2); // v2 + v1
            expect(v2IncrementalSummary.blockCount).toBe(1); // only v2
            expect(v2IncrementalSummary.cids).toContain(v2Cid.toString());
            expect(v2IncrementalSummary.cids).not.toContain(v1Cid.toString());

            // Incremental should be smaller
            expect(v2IncrementalSummary.totalSize).toBeLessThan(v2FullSummary.totalSize);
            const savings = ((1 - v2IncrementalSummary.totalSize / v2FullSummary.totalSize) * 100).toFixed(1);
            console.log(`Savings: ${savings}% (${v2IncrementalSummary.blockCount} vs ${v2FullSummary.blockCount} blocks)`);

            console.log('✅ Incremental export successful');
        });

        it('should handle incremental export with shared blocks', async () => {
            console.log('Testing incremental export with shared structure...');

            const timestamp = Date.now();
            const leaf1 = { id: `leaf1-${timestamp}`, value: 'A' };
            const leaf2 = { id: `leaf2-${timestamp}`, value: 'B' };
            const leaf3 = { id: `leaf3-${timestamp}`, value: 'C' };

            const leaf1Cid = await ipfs.testOfflineClient.putWithCodec(leaf1, { codec: 'dag-cbor' });
            const leaf2Cid = await ipfs.testOfflineClient.putWithCodec(leaf2, { codec: 'dag-cbor' });
            const leaf3Cid = await ipfs.testOfflineClient.putWithCodec(leaf3, { codec: 'dag-cbor' });

            // Tree v1 uses leaf1 and leaf2
            const tree1 = { id: `tree1-${timestamp}`, leaves: [leaf1Cid, leaf2Cid] };
            const tree1Cid = await ipfs.testOfflineClient.putWithCodec(tree1, { codec: 'dag-cbor' });

            // Tree v2 uses leaf2 and leaf3 (shares leaf2 with v1)
            const tree2 = { id: `tree2-${timestamp}`, leaves: [leaf2Cid, leaf3Cid] };
            const tree2Cid = await ipfs.testOfflineClient.putWithCodec(tree2, { codec: 'dag-cbor' });

            // Export tree2 incrementally (baseline = tree1)
            const incrementalResponse = await ipfs.testOfflineClient.exportToCAR(tree2Cid, { baselineCid: tree1Cid });
            const incrementalPath = path.join(workbenchDir, 'test-shared-incremental.car');
            await Bun.write(incrementalPath, incrementalResponse);

            // Verify incremental CAR only has new blocks
            const summary = await inspectCAR(incrementalPath);
            expect(summary.roots).toEqual([tree2Cid.toString()]);
            expect(summary.blockCount).toBe(2); // tree2 + leaf3 (not leaf1 or leaf2)
            expect(summary.cids).toContain(tree2Cid.toString());
            expect(summary.cids).toContain(leaf3Cid.toString());
            expect(summary.cids).not.toContain(leaf1Cid.toString());
            expect(summary.cids).not.toContain(leaf2Cid.toString());

            console.log('✅ Shared blocks correctly excluded from incremental export');
        });

        it('should export all blocks when baseline has no overlap', async () => {
            console.log('Testing incremental export with no shared blocks...');

            const timestamp = Date.now();
            const data1 = { id: `data1-${timestamp}`, value: 'first' };
            const data2 = { id: `data2-${timestamp}`, value: 'second' };

            const cid1 = await ipfs.testOfflineClient.putWithCodec(data1, { codec: 'dag-cbor' });
            const cid2 = await ipfs.testOfflineClient.putWithCodec(data2, { codec: 'dag-cbor' });

            // Export cid2 with cid1 as baseline (no shared blocks)
            const fullResponse = await ipfs.testOfflineClient.exportToCAR(cid2);
            const incrementalResponse = await ipfs.testOfflineClient.exportToCAR(cid2, { baselineCid: cid1 });

            const fullPath = path.join(workbenchDir, 'test-no-overlap-full.car');
            const incrementalPath = path.join(workbenchDir, 'test-no-overlap-incremental.car');

            await Bun.write(fullPath, fullResponse);
            await Bun.write(incrementalPath, incrementalResponse);

            // Verify both have same structure (no shared blocks)
            const fullSummary = await inspectCAR(fullPath);
            const incrementalSummary = await inspectCAR(incrementalPath);

            expect(incrementalSummary.blockCount).toBe(fullSummary.blockCount);
            expect(incrementalSummary.totalSize).toBe(fullSummary.totalSize);

            console.log(`Both exports have ${fullSummary.blockCount} block(s) (no overlap)`);
            console.log('✅ No overlap case handled correctly');
        });
    });

    describe('Edge cases', () => {
        it('should handle empty data', async () => {
            console.log('Testing CAR with empty object...');

            const emptyData = {};
            const cid = await ipfs.testOfflineClient.putWithCodec(emptyData, { codec: 'dag-cbor' });

            const carStream = await ipfs.testOfflineClient.exportToCAR(cid);
            const carPath = path.join(workbenchDir, 'test-empty.car');
            await Bun.write(carPath, carStream);

            const file = Bun.file(carPath);
            const roots = await ipfs.testOfflineClient.importFromCAR(file.stream());

            expect(roots[0].toString()).toBe(cid.toString());
            const retrieved = await ipfs.testOfflineClient.getWithCodec(roots[0]);
            expect(retrieved).toEqual(emptyData);

            console.log('✅ Empty data handled correctly');
        });

        it('should handle large data', async () => {
            console.log('Testing CAR with large data...');

            // Create a large array
            const largeArray = Array.from({ length: 1000 }, (_, i) => ({
                id: i,
                data: `Item ${i}`,
                timestamp: Date.now() + i,
            }));

            const largeData = {
                items: largeArray,
                count: largeArray.length,
            };

            const cid = await ipfs.testOfflineClient.putWithCodec(largeData, { codec: 'dag-cbor' });
            console.log(`Large data CID: ${cid.toString()}`);

            const carStream = await ipfs.testOfflineClient.exportToCAR(cid);
            const carPath = path.join(workbenchDir, 'test-large.car');
            await Bun.write(carPath, carStream);

            const file = Bun.file(carPath);
            console.log(`CAR file size: ${file.size} bytes`);

            const roots = await ipfs.testOfflineClient.importFromCAR(file.stream());

            expect(roots[0].toString()).toBe(cid.toString());
            const retrieved = await ipfs.testOfflineClient.getWithCodec(roots[0]);
            expect(retrieved.count).toBe(1000);
            expect(retrieved.items).toHaveLength(1000);

            console.log('✅ Large data handled correctly');
        });

        it('should accept CID string or CID object for export', async () => {
            console.log('Testing exportToCAR with both string and CID object...');

            const testData = { test: 'CID types' };
            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'dag-cbor' });

            // Export with CID object
            const stream1 = await ipfs.testOfflineClient.exportToCAR(cid);
            const path1 = path.join(workbenchDir, 'test-cid-object.car');
            await Bun.write(path1, stream1);

            // Export with CID string
            const stream2 = await ipfs.testOfflineClient.exportToCAR(cid.toString());
            const path2 = path.join(workbenchDir, 'test-cid-string.car');
            await Bun.write(path2, stream2);

            // Both should work
            const file1 = Bun.file(path1);
            const file2 = Bun.file(path2);

            expect(await file1.exists()).toBe(true);
            expect(await file2.exists()).toBe(true);

            console.log('✅ Both CID string and object accepted');
        });
    });
});
