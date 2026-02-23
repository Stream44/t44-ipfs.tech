#!/usr/bin/env bun test

// Skip liveClient tests in CI - requires local IPFS daemon on port 5001
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

import * as bunTest from 'bun:test'
import { run } from 't44/standalone-rt'

const {
    test: { describe, it, expect },
    ipfs,
} = await run(async ({ encapsulate, CapsulePropertyTypes, makeImportStack }: any) => {
    const spine = await encapsulate({
        '#@stream44.studio/encapsulate/spine-contracts/CapsuleSpineContract.v0': {
            '#@stream44.studio/encapsulate/structs/Capsule': {},
            '#': {
                test: {
                    type: CapsulePropertyTypes.Mapping,
                    value: 't44/caps/ProjectTest',
                    options: {
                        '#': {
                            bunTest,
                            env: {}
                        }
                    }
                },
                ipfs: {
                    type: CapsulePropertyTypes.Mapping,
                    value: './IpfsWorkbench'
                },
            }
        }
    }, {
        importMeta: import.meta,
        importStack: makeImportStack(),
        capsuleName: '@stream44.studio/t44-ipfs.tech/caps/IpfsWorkbench.test'
    })
    return { spine }
}, async ({ spine, apis }: any) => {
    return apis[spine.capsuleSourceLineRef]
}, {
    importMeta: import.meta
})

describe('IpfsWorkbench', function () {

    // ──────────────────────────────────────────────────────────────────
    // 1. CID constant
    // ──────────────────────────────────────────────────────────────────

    describe('1. CID constant', function () {

        it('should expose CID class', async function () {
            expect(ipfs.CID).toBeDefined()
            expect(typeof ipfs.CID.parse).toBe('function')
        })

        it('should parse a valid CID string', async function () {
            const cidStr = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
            const cid = ipfs.CID.parse(cidStr)
            expect(cid).toBeDefined()
            expect(cid.toString()).toBe(cidStr)
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 2. Cache directory
    // ──────────────────────────────────────────────────────────────────

    describe('2. Cache directory', function () {

        it('should return cache dir path', async function () {
            const cacheDir = ipfs.cacheDir
            expect(cacheDir).toBeDefined()
            expect(typeof cacheDir).toBe('string')
            expect(cacheDir).toContain('IpfsWorkbench')
        })

        it('should ensure cache dir exists', async function () {
            const cacheDir = await ipfs.ensureCacheDir()
            expect(cacheDir).toBeDefined()

            const { access } = await import('fs/promises')
            const exists = await access(cacheDir).then(() => true).catch(() => false)
            expect(exists).toBe(true)
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 3. Live connection/client
    // ──────────────────────────────────────────────────────────────────

    describe('3. Live connection/client', function () {

        it('should create live connection', async function () {
            const connection = ipfs.liveConnection
            expect(connection).toBeDefined()
        })

        it('should create live client', async function () {
            const client = ipfs.liveClient
            expect(client).toBeDefined()
        })

        it('should memoize live connection', async function () {
            const conn1 = ipfs.liveConnection
            const conn2 = ipfs.liveConnection
            expect(conn1).toBe(conn2)
        })

        it('should memoize live client', async function () {
            const client1 = ipfs.liveClient
            const client2 = ipfs.liveClient
            expect(client1).toBe(client2)
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 4. Test online connection/client/server
    // ──────────────────────────────────────────────────────────────────

    describe('4. Test online connection/client/server', function () {

        it('should create test online connection with correct ports', async function () {
            const connection = ipfs.testOnlineConnection
            expect(connection).toBeDefined()
            expect(connection.rpcPort).toBe(5101)
            expect(connection.gatewayPort).toBe(7180)
        })

        it('should create test online client', async function () {
            const client = ipfs.testOnlineClient
            expect(client).toBeDefined()
        })

        it('should create test online server', async function () {
            const server = await ipfs.testOnlineServer
            expect(server).toBeDefined()
            expect(typeof server.start).toBe('function')
            expect(typeof server.isRunning).toBe('function')
        })

        it('should memoize test online connection', async function () {
            const conn1 = ipfs.testOnlineConnection
            const conn2 = ipfs.testOnlineConnection
            expect(conn1).toBe(conn2)
        })

        it('should memoize test online client', async function () {
            const client1 = ipfs.testOnlineClient
            const client2 = ipfs.testOnlineClient
            expect(client1).toBe(client2)
        })

        it('should memoize test online server', async function () {
            const server1 = await ipfs.testOnlineServer
            const server2 = await ipfs.testOnlineServer
            expect(server1).toBe(server2)
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 5. Test offline connection/client/server
    // ──────────────────────────────────────────────────────────────────

    describe('5. Test offline connection/client/server', function () {

        it('should create test offline connection with correct ports', async function () {
            const connection = ipfs.testOfflineConnection
            expect(connection).toBeDefined()
            expect(connection.rpcPort).toBe(5102)
            expect(connection.gatewayPort).toBe(7181)
        })

        it('should create test offline client', async function () {
            const client = ipfs.testOfflineClient
            expect(client).toBeDefined()
        })

        it('should create test offline server', async function () {
            const server = await ipfs.testOfflineServer
            expect(server).toBeDefined()
            expect(typeof server.start).toBe('function')
            expect(typeof server.isRunning).toBe('function')
        })

        it('should memoize test offline connection', async function () {
            const conn1 = ipfs.testOfflineConnection
            const conn2 = ipfs.testOfflineConnection
            expect(conn1).toBe(conn2)
        })

        it('should memoize test offline client', async function () {
            const client1 = ipfs.testOfflineClient
            const client2 = ipfs.testOfflineClient
            expect(client1).toBe(client2)
        })

        it('should memoize test offline server', async function () {
            const server1 = await ipfs.testOfflineServer
            const server2 = await ipfs.testOfflineServer
            expect(server1).toBe(server2)
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 6. Resource tracking (refactored from memo)
    // ──────────────────────────────────────────────────────────────────

    describe('6. Resource tracking', function () {

        it('should have resource tracking Maps', async function () {
            expect(ipfs.mfsPaths).toBeDefined()
            expect(typeof ipfs.mfsPaths).toBe('object')
            expect(ipfs.cids).toBeDefined()
            expect(typeof ipfs.cids).toBe('object')
            expect(ipfs.ipnsKeyFiles).toBeDefined()
            expect(typeof ipfs.ipnsKeyFiles).toBe('object')
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 7. Cleanup function
    // ──────────────────────────────────────────────────────────────────

    describe('7. Cleanup function', function () {

        it('should have cleanup function', async function () {
            expect(typeof ipfs.cleanup).toBe('function')
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 8. Start test servers function
    // ──────────────────────────────────────────────────────────────────

    describe('8. Start test servers function', function () {

        it('should have startTestServers function', async function () {
            expect(typeof ipfs.startTestServers).toBe('function')
        })
    })

    // ──────────────────────────────────────────────────────────────────
    // 9. Basic IPFS read/write per client
    // ──────────────────────────────────────────────────────────────────

    describe('9. Basic IPFS read/write per client', function () {

        (isCI ? it.skip : it)('should store and retrieve a block via liveClient', async function () {
            const isRunning = await fetch('http://127.0.0.1:5001/api/v0/id', { method: 'POST' })
                .then(r => r.ok).catch(() => false)
            if (!isRunning) {
                throw new Error(
                    'Live IPFS daemon is not running on port 5001.\n' +
                    'Start it with: brew services start ipfs\n' +
                    'Or: ipfs daemon &'
                )
            }

            const client = ipfs.liveClient
            const data = new TextEncoder().encode('IpfsWorkbench live test')
            const hash = await client.hasher.digest(data)
            const cid = ipfs.CID.create(1, 0x55, hash)

            await client.putBlock(cid, data)
            const retrieved = await client.getBlock(cid)

            expect(new Uint8Array(retrieved)).toEqual(data)
        })

        it('should store and retrieve a block via testOnlineClient', async function () {
            const client = ipfs.testOnlineClient
            const data = new TextEncoder().encode('IpfsWorkbench online test')
            const hash = await client.hasher.digest(data)
            const cid = ipfs.CID.create(1, 0x55, hash)

            await client.putBlock(cid, data)
            const retrieved = await client.getBlock(cid)

            expect(new Uint8Array(retrieved)).toEqual(data)
        })

        it('should store and retrieve a block via testOfflineClient', async function () {
            const client = ipfs.testOfflineClient
            const data = new TextEncoder().encode('IpfsWorkbench offline test')
            const hash = await client.hasher.digest(data)
            const cid = ipfs.CID.create(1, 0x55, hash)

            await client.putBlock(cid, data)
            const retrieved = await client.getBlock(cid)

            expect(new Uint8Array(retrieved)).toEqual(data)
        })
    })

})
