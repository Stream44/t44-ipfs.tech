
export const testConfig = {
    group: 'ipfs',
    runOnAll: false,
}

import * as bunTest from 'bun:test';
import { run } from 't44/standalone-rt';
import { CID, IPFSClient, IPFSConnection } from './ipfs';

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
        capsuleName: '@stream44.studio/t44-ipfs.tech/lib/ipfs-trustless-gateway.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
});

describe('IPFSClient - Trustless Gateway', () => {
    let trustlessClient: any;
    let localClient: any;
    let testCid: CID;
    const testData = {
        name: 'Trustless Gateway Test',
        version: '1.0.0',
        description: 'Testing trustless gateway with dag-cbor',
        timestamp: Date.now()
    };

    beforeAll(async () => {
        const connection = new IPFSConnection({
            protocol: 'http',
            hostname: '127.0.0.1',
            rpcPort: 5101,
            gatewayPort: 7180,
            gatewayTrustlessHost: 'dweb.link'
        });

        trustlessClient = new IPFSClient({
            connection,
            verbose: false
        });

        localClient = ipfs.testOnlineClient;

        testCid = await localClient.putWithCodec(testData, { codec: 'dag-cbor' });
        // NOTE: Not necessary
        // await localClient.pinCid(testCid.toString());

        console.log(`Test CID created and pinned: ${testCid.toString()}`);
    });

    afterAll(async () => {
        if (testCid) {
            await localClient.unpinCid(testCid.toString(), { ignoreMissing: true });
        }
    });

    describe('IPFSConnection with Trustless Gateway', () => {
        it('should create connection with gatewayTrustlessHost', () => {
            const connection = trustlessClient.getConnection();

            expect(connection.gatewayTrustlessHost).toBe('dweb.link');
            expect(connection.rpcUrl).toBe('http://127.0.0.1:5101');
            expect(connection.gatewayUrl).toBe('http://127.0.0.1:7180');

            console.log('✅ Connection created with trustless gateway host');
        });

        it('should serialize connection with gatewayTrustlessHost to JSON', () => {
            const connection = trustlessClient.getConnection();
            const json = connection.toJSON();

            expect(json.gatewayTrustlessHost).toBe('dweb.link');
            expect(json.rpcUrl).toBe('http://127.0.0.1:5101');
            expect(json.gatewayUrl).toBe('http://127.0.0.1:7180');

            console.log('✅ Connection serialized with trustless gateway host:', json);
        });

        it('should deserialize connection with gatewayTrustlessHost from JSON', () => {
            const jsonData = {
                rpcUrl: 'http://127.0.0.1:5101',
                gatewayUrl: 'http://127.0.0.1:7180',
                gatewayTrustlessHost: 'dweb.link'
            };

            const connection = IPFSConnection.fromJSON(jsonData);

            expect(connection.gatewayTrustlessHost).toBe('dweb.link');
            expect(connection.rpcUrl).toBe(jsonData.rpcUrl);
            expect(connection.gatewayUrl).toBe(jsonData.gatewayUrl);

            console.log('✅ Connection deserialized with trustless gateway host');
        });

        it('should handle null gatewayTrustlessHost in serialization', () => {
            const connection = new IPFSConnection({
                protocol: 'http',
                hostname: '127.0.0.1',
                rpcPort: 5101,
                gatewayPort: 7180
            });

            const json = connection.toJSON();

            expect('gatewayTrustlessHost' in json).toBe(false);

            console.log('✅ Null gatewayTrustlessHost not included in JSON');
        });

        it('should round-trip serialize and deserialize with gatewayTrustlessHost', () => {
            const originalConnection = trustlessClient.getConnection();
            const json = originalConnection.toJSON();
            const restoredConnection = IPFSConnection.fromJSON(json);

            expect(restoredConnection.gatewayTrustlessHost).toBe(originalConnection.gatewayTrustlessHost);
            expect(restoredConnection.rpcUrl).toBe(originalConnection.rpcUrl);
            expect(restoredConnection.gatewayUrl).toBe(originalConnection.gatewayUrl);

            console.log('✅ Round-trip serialization successful with trustless gateway');
        });
    });

    describe('Trustless Gateway Block Operations', () => {
        it('should check if block exists via trustless gateway', async () => {
            const exists = await trustlessClient.hasBlock(testCid);

            expect(exists).toBe(true);

            console.log('✅ Block existence verified via trustless gateway');
        }, 30000);

        it('should retrieve and decode block via trustless gateway using CAR format', async () => {
            const retrievedData = await trustlessClient.getWithCodec(testCid);

            expect(retrievedData).toBeDefined();
            expect(retrievedData.name).toBe(testData.name);
            expect(retrievedData.version).toBe(testData.version);
            expect(retrievedData.description).toBe(testData.description);

            console.log('✅ Block retrieved and decoded successfully via trustless gateway');
        }, 30000);

        it('should handle non-existent block via trustless gateway', async () => {
            const fakeHash = await localClient.hasher.digest(new TextEncoder().encode('non-existent-data-12345'));
            const fakeCid = CID.create(1, 0x55, fakeHash);

            let errorThrown = false;
            try {
                await trustlessClient.getBlock(fakeCid);
            } catch (error: any) {
                errorThrown = true;
                expect(error.message).toBeDefined();
                console.log(`✅ Error thrown as expected: ${error.message}`);
            }

            expect(errorThrown).toBe(true);
        }, 30000);
    });

    describe('CAR File Operations with Trustless Gateway', () => {
        let carCid: string;
        let dagCid: CID;

        it('should store CAR file locally', async () => {
            const files = [
                { path: 'test1.txt', content: 'Content of test file 1' },
                { path: 'test2.txt', content: 'Content of test file 2' },
                { path: 'subdir/test3.txt', content: 'Content of test file 3' }
            ];

            carCid = await localClient.importFiles(files, { pin: true });

            console.log(`CAR directory CID: ${carCid}`);

            expect(carCid).toBeDefined();
            expect(carCid.length).toBeGreaterThan(0);

            console.log('✅ CAR file stored successfully');
        }, 30000);

        it('should create and retrieve a DAG via trustless gateway', async () => {
            const dagData = {
                message: 'Test DAG node',
                nested: {
                    value: 42,
                    array: [1, 2, 3]
                }
            };

            dagCid = await localClient.putWithCodec(dagData, { codec: 'dag-cbor' });
            await localClient.pinCid(dagCid.toString());

            const retrieved = await trustlessClient.getWithCodec(dagCid);

            expect(retrieved.message).toBe(dagData.message);
            expect(retrieved.nested.value).toBe(dagData.nested.value);

            console.log(`✅ DAG retrieved and decoded via trustless gateway`);
        }, 30000);

        afterAll(async () => {
            if (carCid) {
                await localClient.unpinCid(carCid, { ignoreMissing: true });
            }
            if (dagCid) {
                await localClient.unpinCid(dagCid.toString(), { ignoreMissing: true });
            }
        });
    });

    describe('Trustless Gateway Integration', () => {
        it('should retrieve same data via both trustless gateway and local RPC', async () => {
            const trustlessData = await trustlessClient.getWithCodec(testCid);
            const localData = await localClient.getWithCodec(testCid);

            expect(trustlessData).toEqual(localData);
            expect(trustlessData.name).toBe(testData.name);

            console.log('✅ Data consistency verified between trustless gateway and local RPC');
        }, 30000);

        it('should handle raw blocks via trustless gateway', async () => {
            const rawData = new TextEncoder().encode('Raw block test data');
            const hash = await localClient.hasher.digest(rawData);
            const rawCid = CID.create(1, 0x55, hash);

            await localClient.putBlock(rawCid, rawData);
            await localClient.pinCid(rawCid.toString());

            const retrieved = await trustlessClient.getBlock(rawCid);

            expect(retrieved).toEqual(rawData);

            await localClient.unpinCid(rawCid.toString(), { ignoreMissing: true });

            console.log('✅ Raw block successfully retrieved via trustless gateway');
        }, 30000);
    });
});
