⚠️ **WARNING:** This repository may get squashed and force-pushed if the [GordianOpenIntegrity](https://github.com/Stream44/t44-ipfs.tech) implementation must change in incompatible ways. Keep your diffs until the **GordianOpenIntegrity** system is stable.

🔷 **Open Development Project:** The implementation is a preview release for community feedback.

⚠️ **Disclaimer:** Under active development. Code has not been audited, APIs and interfaces are subject to change.

`t44` Capsules for IPFS [![Tests](https://github.com/Stream44/t44-ipfs.tech/actions/workflows/test.yaml/badge.svg)](https://github.com/Stream44/t44-ipfs.tech/actions/workflows/test.yaml?query=branch%3Amain)
===

This project [encapsulates](https://github.com/Stream44/encapsulate) various [IPFS](https://ipfs.tech/) javascript libraries for use in [t44](https://github.com/Stream44/t44).

IPFS low-level libraries are wrapped into capsules and combined into new higher order capsules.


Capsules: Higher Order
---

### `IpfsWorkbench`

Provides IPFS server management and client APIs for use in Test Driven Development (TDD). Uses `ipfs` capsule.


Capsules: Low Level
---

### `ipfs` (IPFS Server & CLient)

Abstracts IPFS standard and [kubo](https://github.com/ipfs/kubo) apis into `IPFSServer` and `IPFSClient` JavaScript classes. 


Provenance
===

[![Gordian Open Integrity](https://github.com/Stream44/t44-ipfs.tech/actions/workflows/gordian-open-integrity.yaml/badge.svg)](https://github.com/Stream44/t44-ipfs.tech/actions/workflows/gordian-open-integrity.yaml?query=branch%3Amain) [![DCO Signatures](https://github.com/Stream44/t44-ipfs.tech/actions/workflows/dco.yaml/badge.svg)](https://github.com/Stream44/t44-ipfs.tech/actions/workflows/dco.yaml?query=branch%3Amain)

Repository DID: `did:repo:3057fddfce16cbc282f4c20568c1dd1fdd150de5`

<table>
  <tr>
    <td><strong>Inception Mark</strong></td>
    <td><img src=".o/GordianOpenIntegrity-InceptionLifehash.svg" width="64" height="64"></td>
    <td><strong>Current Mark</strong></td>
    <td><img src=".o/GordianOpenIntegrity-CurrentLifehash.svg" width="64" height="64"></td>
    <td>Trust established using<br/><a href="https://github.com/Stream44/t44-ipfs.tech">Stream44/t44-ipfs.tech</a></td>
  </tr>
</table>

(c) 2026 [Christoph.diy](https://christoph.diy) • Code: `BSD-2-Clause-Patent` • Text: `CC-BY` • Created with [Stream44.Studio](https://Stream44.Studio)
