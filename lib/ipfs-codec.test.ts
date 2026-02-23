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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-codec.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

describe('IPFSClient - Codec Support', () => {

    describe('dag-cbor codec', () => {
        it('should store and retrieve CBOR data', async () => {
            console.log('Testing dag-cbor codec...');

            const testData = {
                name: 'Alice',
                age: 30,
                tags: ['developer', 'ipfs'],
                metadata: {
                    created: Date.now(),
                    active: true,
                },
            };

            // Store with dag-cbor codec
            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'dag-cbor' });

            console.log(`✅ CBOR data stored: ${cid.toString()}`);
            expect(cid).toBeDefined();
            expect(cid.code).toBe(0x71); // dag-cbor code

            // Retrieve and decode
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(testData);
            console.log('✅ CBOR data retrieved and verified');
        });

        it('should handle complex nested CBOR structures', async () => {
            console.log('Testing complex CBOR structures...');

            const complexData = {
                users: [
                    { id: 1, name: 'Alice', roles: ['admin', 'user'] },
                    { id: 2, name: 'Bob', roles: ['user'] },
                ],
                config: {
                    nested: {
                        deep: {
                            value: 'test',
                            numbers: [1, 2, 3, 4, 5],
                        },
                    },
                },
            };

            const cid = await ipfs.testOfflineClient.putWithCodec(complexData, { codec: 'dag-cbor' });
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(complexData);
            console.log('✅ Complex CBOR structure verified');
        });
    });

    describe('dag-json codec', () => {
        it('should store and retrieve JSON data', async () => {
            console.log('Testing dag-json codec...');

            const testData = {
                title: 'IPFS Test',
                version: '1.0.0',
                features: ['blocks', 'codecs', 'pins'],
                settings: {
                    enabled: true,
                    timeout: 5000,
                },
            };

            // Store with dag-json codec
            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'dag-json' });

            console.log(`✅ JSON data stored: ${cid.toString()}`);
            expect(cid).toBeDefined();
            expect(cid.code).toBe(0x0129); // dag-json code

            // Retrieve and decode
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(testData);
            console.log('✅ JSON data retrieved and verified');
        });

        it('should handle arrays and primitives in JSON', async () => {
            console.log('Testing JSON arrays and primitives...');

            const arrayData = [
                'string',
                123,
                true,
                null,
                { nested: 'object' },
                [1, 2, 3],
            ];

            const cid = await ipfs.testOfflineClient.putWithCodec(arrayData, { codec: 'dag-json' });
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(arrayData);
            console.log('✅ JSON arrays and primitives verified');
        });
    });

    describe('dag-pb codec', () => {
        it('should store and retrieve Protocol Buffer data', async () => {
            console.log('Testing dag-pb codec...');

            // dag-pb expects a specific structure with Data and Links
            const testData = {
                Data: new Uint8Array([1, 2, 3, 4, 5]),
                Links: [],
            };

            // Store with dag-pb codec
            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'dag-pb' });

            console.log(`✅ PB data stored: ${cid.toString()}`);
            expect(cid).toBeDefined();
            expect(cid.code).toBe(0x70); // dag-pb code

            // Retrieve and decode
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved.Data).toEqual(testData.Data);
            expect(retrieved.Links).toEqual(testData.Links);
            console.log('✅ PB data retrieved and verified');
        });

        it('should handle dag-pb with links', async () => {
            console.log('Testing dag-pb with links...');

            // Create a simple block first to link to
            const linkedData = {
                Data: new Uint8Array([10, 20, 30]),
                Links: [],
            };
            const linkedCid = await ipfs.testOfflineClient.putWithCodec(linkedData, { codec: 'dag-pb' });

            // Create a block with a link
            const dataWithLinks = {
                Data: new Uint8Array([100, 200]),
                Links: [
                    {
                        Hash: linkedCid,
                        Name: 'child',
                        Tsize: 3,
                    },
                ],
            };

            const cid = await ipfs.testOfflineClient.putWithCodec(dataWithLinks, { codec: 'dag-pb' });
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved.Data).toEqual(dataWithLinks.Data);
            expect(retrieved.Links).toHaveLength(1);
            expect(retrieved.Links[0].Name).toBe('child');
            console.log('✅ PB data with links verified');
        });
    });

    describe('raw codec', () => {
        it('should store and retrieve raw bytes', async () => {
            console.log('Testing raw codec...');

            const testData = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"

            // Store with raw codec
            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'raw' });

            console.log(`✅ Raw data stored: ${cid.toString()}`);
            expect(cid).toBeDefined();
            expect(cid.code).toBe(0x55); // raw code

            // Retrieve and decode
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(testData);
            console.log('✅ Raw data retrieved and verified');
        });

        it('should handle binary data with raw codec', async () => {
            console.log('Testing raw codec with binary data...');

            const binaryData = new Uint8Array(256);
            for (let i = 0; i < 256; i++) {
                binaryData[i] = i;
            }

            const cid = await ipfs.testOfflineClient.putWithCodec(binaryData, { codec: 'raw' });
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(binaryData);
            console.log('✅ Binary data verified');
        });
    });

    describe('Codec interoperability', () => {
        it('should correctly identify codec from CID', async () => {
            console.log('Testing codec identification...');

            const cborData = { type: 'cbor' };
            const jsonData = { type: 'json' };
            const pbData = { Data: new Uint8Array([1]), Links: [] };
            const rawData = new Uint8Array([1, 2, 3]);

            const cborCid = await ipfs.testOfflineClient.putWithCodec(cborData, { codec: 'dag-cbor' });
            const jsonCid = await ipfs.testOfflineClient.putWithCodec(jsonData, { codec: 'dag-json' });
            const pbCid = await ipfs.testOfflineClient.putWithCodec(pbData, { codec: 'dag-pb' });
            const rawCid = await ipfs.testOfflineClient.putWithCodec(rawData, { codec: 'raw' });

            // Verify codec codes
            expect(cborCid.code).toBe(0x71);
            expect(jsonCid.code).toBe(0x0129);
            expect(pbCid.code).toBe(0x70);
            expect(rawCid.code).toBe(0x55);

            // Retrieve with automatic codec detection
            const cborRetrieved = await ipfs.testOfflineClient.getWithCodec(cborCid);
            const jsonRetrieved = await ipfs.testOfflineClient.getWithCodec(jsonCid);
            const pbRetrieved = await ipfs.testOfflineClient.getWithCodec(pbCid);
            const rawRetrieved = await ipfs.testOfflineClient.getWithCodec(rawCid);

            expect(cborRetrieved).toEqual(cborData);
            expect(jsonRetrieved).toEqual(jsonData);
            expect(pbRetrieved.Data).toEqual(pbData.Data);
            expect(rawRetrieved).toEqual(rawData);

            console.log('✅ All codecs correctly identified and decoded');
        });

        it('should throw error for unsupported codec', async () => {
            console.log('Testing unsupported codec error...');

            // Create a CID with an unsupported codec code
            const hash = await ipfs.testOfflineClient.hasher.digest(new Uint8Array([1, 2, 3]));
            const unsupportedCid = CID.create(1, 0x9999, hash); // Random unsupported code

            // Store the raw bytes first
            await ipfs.testOfflineClient.putBlock(unsupportedCid, new Uint8Array([1, 2, 3]));

            // Try to retrieve with codec - should throw
            try {
                await ipfs.testOfflineClient.getWithCodec(unsupportedCid);
                throw new Error('Should have thrown an error');
            } catch (error: any) {
                expect(error.message).toContain('Unsupported codec code');
                console.log('✅ Correctly threw error for unsupported codec');
            }
        });
    });

    describe('Default codec behavior', () => {
        it('should default to raw codec when no codec specified', async () => {
            console.log('Testing default codec (raw)...');

            const testData = new Uint8Array([1, 2, 3, 4, 5]);

            // Store without specifying codec - should default to 'raw'
            const cid = await ipfs.testOfflineClient.putWithCodec(testData);

            console.log(`✅ Data stored with default codec: ${cid.toString()}`);
            expect(cid).toBeDefined();
            expect(cid.code).toBe(0x55); // raw code

            // Retrieve and verify
            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);

            expect(retrieved).toEqual(testData);
            console.log('✅ Default codec (raw) verified');
        });

        it('should allow explicit codec override', async () => {
            console.log('Testing explicit codec override...');

            const testData = { message: 'test' };

            // Explicitly specify dag-cbor
            const cid = await ipfs.testOfflineClient.putWithCodec(testData, { codec: 'dag-cbor' });

            expect(cid.code).toBe(0x71); // dag-cbor code

            const retrieved = await ipfs.testOfflineClient.getWithCodec(cid);
            expect(retrieved).toEqual(testData);

            console.log('✅ Explicit codec override verified');
        });
    });

    describe('TypeScript type safety', () => {
        it('should support generic type parameter', async () => {
            console.log('Testing TypeScript generic types...');

            interface User {
                id: number;
                name: string;
                email: string;
            }

            const user: User = {
                id: 1,
                name: 'Alice',
                email: 'alice@example.com',
            };

            const cid = await ipfs.testOfflineClient.putWithCodec(user, { codec: 'dag-cbor' });
            const retrieved = await ipfs.testOfflineClient.getWithCodec<User>(cid);

            // TypeScript should know the type
            expect(retrieved.id).toBe(1);
            expect(retrieved.name).toBe('Alice');
            expect(retrieved.email).toBe('alice@example.com');

            console.log('✅ Generic type parameter works correctly');
        });
    });
});
