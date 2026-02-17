import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import type { PrivateKey } from '@libp2p/interface';
import { ed25519 } from '@noble/curves/ed25519.js';

// ============================================================================
// Cryptographic Key Utilities
// ============================================================================

/**
 * Parse PEM format and extract DER bytes
 * @param pem - PEM-encoded private key string
 * @returns DER-encoded bytes
 */
function parsePemPrivateKey(pem: string): Uint8Array {
    // Remove PEM headers and footers, and decode base64
    const pemLines = pem.split('\n').filter(line =>
        !line.startsWith('-----BEGIN') &&
        !line.startsWith('-----END') &&
        line.trim().length > 0
    );
    const base64 = pemLines.join('');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Parse PKCS8 DER and extract the raw Ed25519 private key
 * @param pkcs8Der - PKCS8 DER-encoded bytes
 * @returns Raw 32-byte Ed25519 private key
 */
function extractPrivateKeyFromPKCS8(pkcs8Der: Uint8Array): Uint8Array {
    // PKCS8 structure for Ed25519:
    // SEQUENCE {
    //   version INTEGER,
    //   algorithm SEQUENCE { OID, ... },
    //   privateKey OCTET STRING (contains another OCTET STRING with the actual key)
    // }
    // For Ed25519, the actual 32-byte key is nested inside
    // We'll do a simple search for the 32-byte key pattern

    // Look for the Ed25519 OID: 1.3.101.112 (0x2b 0x65 0x70)
    const ed25519Oid = new Uint8Array([0x2b, 0x65, 0x70]);
    let oidIndex = -1;
    for (let i = 0; i < pkcs8Der.length - 3; i++) {
        if (pkcs8Der[i] === ed25519Oid[0] &&
            pkcs8Der[i + 1] === ed25519Oid[1] &&
            pkcs8Der[i + 2] === ed25519Oid[2]) {
            oidIndex = i;
            break;
        }
    }

    if (oidIndex === -1) {
        throw new Error('Not an Ed25519 key');
    }

    // After the OID, look for OCTET STRING tag (0x04) followed by length 0x22 (34 bytes)
    // which contains another OCTET STRING tag (0x04) with length 0x20 (32 bytes) - the actual key
    for (let i = oidIndex + 3; i < pkcs8Der.length - 34; i++) {
        if (pkcs8Der[i] === 0x04 && pkcs8Der[i + 1] === 0x22 &&
            pkcs8Der[i + 2] === 0x04 && pkcs8Der[i + 3] === 0x20) {
            // Found it! Extract the 32-byte key
            return pkcs8Der.slice(i + 4, i + 4 + 32);
        }
    }

    throw new Error('Could not extract Ed25519 private key from PKCS8');
}

/**
 * Convert a PEM-encoded private key (PKCS8 format) to a libp2p PrivateKey object
 * @param pem - PEM-encoded private key string (as exported by IPFS)
 * @returns libp2p PrivateKey object ready for signing
 */
export function privateKeyFromPem(pem: string): PrivateKey {
    // Parse the PEM private key
    const pkcs8Der = parsePemPrivateKey(pem);
    const rawPrivateKey = extractPrivateKeyFromPKCS8(pkcs8Der);

    // For Ed25519, derive the public key from the private key
    const publicKeyBytes = ed25519.getPublicKey(rawPrivateKey);

    // Combine private and public key (64 bytes total for Ed25519)
    const combinedKey = new Uint8Array(64);
    combinedKey.set(rawPrivateKey, 0);
    combinedKey.set(publicKeyBytes, 32);

    // Create a protobuf-encoded private key for libp2p
    // Format: Type (varint) + Data (length-prefixed bytes)
    const keyTypeEd25519 = 1; // Ed25519 = 1 in the protobuf enum
    const protoKey = new Uint8Array([
        0x08, keyTypeEd25519,  // field 1 (Type): varint
        0x12, combinedKey.length, ...combinedKey  // field 2 (Data): length-delimited (64 bytes)
    ]);

    // Import the key using libp2p crypto
    return privateKeyFromProtobuf(protoKey);
}
