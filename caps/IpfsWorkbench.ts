import { join, basename } from 'path'
import { mkdir, rm, access } from 'fs/promises'
import { IPFSClient, IPFSServer, IPFSConnection, CID } from '../lib/ipfs'

export async function capsule({
    encapsulate,
    CapsulePropertyTypes,
    makeImportStack
}: {
    encapsulate: any
    CapsulePropertyTypes: any
    makeImportStack: any
}) {

    return encapsulate({
        '#@stream44.studio/encapsulate/spine-contracts/CapsuleSpineContract.v0': {
            '#@stream44.studio/encapsulate/structs/Capsule': {},
            '#': {
                test: {
                    type: CapsulePropertyTypes.Mapping,
                    value: 't44/caps/ProjectTest',
                },

                CID: {
                    type: CapsulePropertyTypes.Constant,
                    value: CID
                },

                // Track resources for cleanup
                mfsPaths: {
                    type: CapsulePropertyTypes.Literal,
                    value: new Map<string, boolean>()
                },
                cids: {
                    type: CapsulePropertyTypes.Literal,
                    value: new Map<string, boolean>()
                },
                ipnsKeyFiles: {
                    type: CapsulePropertyTypes.Literal,
                    value: new Map<string, boolean>()
                },

                cacheDir: {
                    type: CapsulePropertyTypes.Literal,
                    value: undefined as string | undefined
                },

                ensureCacheDir: {
                    type: CapsulePropertyTypes.Function,
                    value: async function (this: any): Promise<string> {
                        const dir = this.cacheDir
                        await mkdir(dir, { recursive: true })
                        return dir
                    }
                },

                liveConnection: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: function (this: any): IPFSConnection {
                        return new IPFSConnection()
                    },
                    memoize: true  // Cache forever - reuse same connection
                },

                liveClient: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: function (this: any): IPFSClient {
                        const connection = this.liveConnection
                        return new IPFSClient({ connection })
                    },
                    memoize: true  // Cache forever - reuse same client
                },

                testOnlineConnection: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: function (this: any): IPFSConnection {
                        return new IPFSConnection({ hostname: '127.0.0.1', rpcPort: 5101, gatewayPort: 7180 })
                    },
                    memoize: true  // Cache forever - reuse same connection
                },

                testOnlineClient: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: function (this: any): IPFSClient {
                        const connection = this.testOnlineConnection
                        const client = new IPFSClient({ connection })

                        client.on('cid:pinned', (cid: string) => {
                            this.cids.set(cid, true)
                        })

                        return client
                    },
                    memoize: true  // Cache forever - reuse same client
                },

                testOnlineServer: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: async function (this: any): Promise<IPFSServer> {
                        const connection = this.testOnlineConnection
                        const cacheDir = await this.ensureCacheDir()
                        const ipfsRepoPath = join(cacheDir, `.~ipldom-ipfs-test-online-${connection.gatewayPort}-repo`)

                        const server = new IPFSServer({ connection: connection, ipfsRepoPath: ipfsRepoPath })

                        server.on('mfs:created', (mfsPath: string) => {
                            this.mfsPaths.set(mfsPath, true)
                        })

                        server.on('ipns:created', (keyFilePath: string) => {
                            this.ipnsKeyFiles.set(keyFilePath, true)
                        })

                        const originalStart = server.start.bind(server)
                        server.start = async (options = {}) => originalStart({ ...options, offline: false })

                        return server
                    },
                    memoize: true  // Cache forever - reuse same server
                },

                testOfflineConnection: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: function (this: any): IPFSConnection {
                        return new IPFSConnection({ hostname: '127.0.0.1', rpcPort: 5102, gatewayPort: 7181 })
                    },
                    memoize: true  // Cache forever - reuse same connection
                },

                testOfflineClient: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: function (this: any): IPFSClient {
                        const connection = this.testOfflineConnection
                        const client = new IPFSClient({ connection })

                        client.on('cid:pinned', (cid: string) => {
                            this.cids.set(cid, true)
                        })

                        return client
                    },
                    memoize: true  // Cache forever - reuse same client
                },

                testOfflineServer: {
                    type: CapsulePropertyTypes.GetterFunction,
                    value: async function (this: any): Promise<IPFSServer> {
                        const connection = this.testOfflineConnection
                        const cacheDir = await this.ensureCacheDir()
                        const ipfsRepoPath = join(cacheDir, `.~ipldom-ipfs-test-offline-${connection.gatewayPort}-repo`)

                        const server = new IPFSServer({ connection: connection, ipfsRepoPath: ipfsRepoPath })

                        server.on('mfs:created', (mfsPath: string) => {
                            this.mfsPaths.set(mfsPath, true)
                        })

                        const originalStart = server.start.bind(server)
                        server.start = async (options = {}) => originalStart({ ...options, offline: true })

                        return server
                    },
                    memoize: true  // Cache forever - reuse same server
                },

                Init: {
                    type: CapsulePropertyTypes.Init,
                    value: async function (this: any): Promise<void> {
                        // If in test mode, start both test servers if not already running
                        if (this.test && this.test.bunTest) {
                            await this.startTestServers()
                        }
                    }
                },

                startTestServers: {
                    type: CapsulePropertyTypes.Function,
                    value: async function (this: any): Promise<void> {
                        const startServer = async (serverOrPromise: IPFSServer | Promise<IPFSServer>) => {
                            const server = await serverOrPromise
                            const isRunning = await server.isRunning()
                            if (!isRunning) {
                                await server.start()
                            }
                        }
                        await Promise.all([
                            startServer(this.testOnlineServer),
                            startServer(this.testOfflineServer)
                        ]).catch(error => {
                            console.error('Failed to start test IPFS servers:', error)
                            throw error
                        })
                    }
                },

                cleanup: {
                    type: CapsulePropertyTypes.Function,
                    value: async function (this: any): Promise<void> {
                        // Only cleanup if in test mode and keepIPFSData is not set
                        if (!this.test || !this.test.bunTest) return
                        if (process.env.WORKSPACE_KEEP_IPFS_DATA) return

                        console.log('\n=== Cleanup: Removing all test data ===')

                        // Clean up IPNS key files
                        if (this.ipnsKeyFiles && typeof this.ipnsKeyFiles.keys === 'function') {
                            for (const keyFilePath of this.ipnsKeyFiles.keys()) {
                                try {
                                    const exists = await access(keyFilePath).then(() => true).catch(() => false)
                                    if (exists) {
                                        await rm(keyFilePath)
                                        console.log(`✅ Removed cached IPNS key: ${keyFilePath}`)
                                    }
                                } catch (error) {
                                    console.log(`⚠️  Failed to remove IPNS key file ${keyFilePath}: ${error}`)
                                }
                            }
                        }

                        // Clean up MFS paths
                        if (this.mfsPaths && typeof this.mfsPaths.keys === 'function') {
                            const onlineClient = this.testOnlineClient
                            for (const mfsPath of this.mfsPaths.keys()) {
                                try {
                                    await onlineClient.removeFromMFS(mfsPath, { ignoreMissing: true })
                                    console.log(`✅ Removed MFS: ${mfsPath}`)
                                } catch (error) {
                                    console.log(`⚠️  Failed to remove MFS ${mfsPath}: ${error}`)
                                }
                            }
                        }

                        // Clean up pinned CIDs
                        if (this.cids && typeof this.cids.keys === 'function') {
                            const onlineClient = this.testOnlineClient
                            for (const cid of this.cids.keys()) {
                                try {
                                    const isPinned = await onlineClient.isPinned(cid)
                                    if (isPinned) {
                                        await onlineClient.unpinCid(cid, { ignoreMissing: true })
                                        console.log(`✅ Unpinned: ${cid}`)
                                    }
                                } catch (error) {
                                    console.log(`⚠️  Failed to unpin ${cid}: ${error}`)
                                }
                            }
                        }

                        console.log('✅ Cleanup complete')
                    }
                },

                Dispose: {
                    type: CapsulePropertyTypes.Dispose,
                    value: async function (this: any): Promise<void> {
                        await this.cleanup()
                    }
                }
            }
        }
    }, {
        importMeta: import.meta,
        importStack: makeImportStack(),
        capsuleName: capsule['#'],
    })
}
capsule['#'] = '@stream44.studio/t44-ipfs.tech/caps/IpfsWorkbench'
