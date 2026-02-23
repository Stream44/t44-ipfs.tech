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
                IPFSClient: {
                    type: CapsulePropertyTypes.Constant,
                    value: IPFSClient,
                },

                IPFSServer: {
                    type: CapsulePropertyTypes.Constant,
                    value: IPFSServer,
                },

                IPFSConnection: {
                    type: CapsulePropertyTypes.Constant,
                    value: IPFSConnection,
                },

                CID: {
                    type: CapsulePropertyTypes.Constant,
                    value: CID,
                },
            }
        }
    }, {
        importMeta: import.meta,
        importStack: makeImportStack(),
        capsuleName: '@stream44.studio/t44-ipfs.tech/caps/IpfsLib',
    })
}
