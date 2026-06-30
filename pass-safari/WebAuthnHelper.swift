//
//  WebAuthnHelper.swift
//  pass-safari
//
//  WebAuthn-konforme Datenstrukturen und Utilities
//

import Foundation
import CryptoKit

struct WebAuthnHelper {
    
    // MARK: - Attestation Object
    
    /// Erstellt ein WebAuthn-konformes attestationObject
    /// Format: CBOR map mit fmt, attStmt, authData
    static func buildAttestationObject(
        rpIdHash: Data,
        credentialId: Data,
        publicKeyBytes: Data,
        signCount: UInt32 = 0
    ) -> Data {
        // Authenticator Data aufbauen
        let authData = buildAuthenticatorData(
            rpIdHash: rpIdHash,
            flags: 0x45, // UP=1, UV=0, AT=1, ED=0
            signCount: signCount,
            attestedCredentialData: buildAttestedCredentialData(
                credentialId: credentialId,
                publicKeyBytes: publicKeyBytes
            )
        )
        
        // CBOR Map erstellen
        // Für PoC: Verwenden wir "none" attestation
        let attestationObject: [String: Any] = [
            "fmt": "none",
            "attStmt": [:] as [String: Any],
            "authData": authData
        ]
        
        // In echtem Code würde hier PotentCBOR verwendet:
        // return try! CBOREncoder().encode(attestationObject)
        
        // Für jetzt: Einfaches Encoding (NICHT WebAuthn-konform!)
        return try! JSONSerialization.data(withJSONObject: attestationObject)
    }
    
    // MARK: - Authenticator Data
    
    /// Erstellt authenticatorData nach WebAuthn Spec
    /// Struktur: rpIdHash (32) | flags (1) | signCount (4) | attestedCredentialData (variable)
    static func buildAuthenticatorData(
        rpIdHash: Data,
        flags: UInt8,
        signCount: UInt32,
        attestedCredentialData: Data? = nil
    ) -> Data {
        var authData = Data()
        
        // 1. RP ID Hash (32 bytes)
        authData.append(rpIdHash)
        
        // 2. Flags (1 byte)
        authData.append(flags)
        
        // 3. Sign Count (4 bytes, big-endian)
        var count = signCount.bigEndian
        authData.append(Data(bytes: &count, count: 4))
        
        // 4. Attested Credential Data (optional, nur bei registration)
        if let attestedData = attestedCredentialData {
            authData.append(attestedData)
        }
        
        return authData
    }
    
    // MARK: - Attested Credential Data
    
    /// Erstellt attestedCredentialData
    /// Struktur: aaguid (16) | credentialIdLength (2) | credentialId (L) | credentialPublicKey (CBOR)
    static func buildAttestedCredentialData(
        credentialId: Data,
        publicKeyBytes: Data,
        aaguid: Data = Data(count: 16) // Null AAGUID
    ) -> Data {
        var data = Data()
        
        // 1. AAGUID (16 bytes)
        data.append(aaguid)
        
        // 2. Credential ID Length (2 bytes, big-endian)
        var idLength = UInt16(credentialId.count).bigEndian
        data.append(Data(bytes: &idLength, count: 2))
        
        // 3. Credential ID
        data.append(credentialId)
        
        // 4. Credential Public Key (COSE format)
        let coseKey = buildCOSEPublicKey(publicKeyBytes: publicKeyBytes)
        data.append(coseKey)
        
        return data
    }
    
    // MARK: - COSE Public Key
    
    /// Erstellt COSE-formatiertes Public Key
    /// Format: CBOR map für ES256 (ECDSA mit P-256)
    static func buildCOSEPublicKey(publicKeyBytes: Data) -> Data {
        // COSE Key Type Parameters für ES256:
        // kty: 2 (EC2)
        // alg: -7 (ES256)
        // crv: 1 (P-256)
        // x: x-coordinate (32 bytes)
        // y: y-coordinate (32 bytes)
        
        // Public Key ist in uncompressed format: 0x04 || x || y (65 bytes total)
        guard publicKeyBytes.count >= 65 else {
            return Data() // Error handling
        }
        
        let xCoord = publicKeyBytes[1..<33]
        let yCoord = publicKeyBytes[33..<65]
        
        let coseKey: [Int: Any] = [
            1: 2,                    // kty: EC2
            3: -7,                   // alg: ES256
            -1: 1,                   // crv: P-256
            -2: xCoord,              // x-coordinate
            -3: yCoord               // y-coordinate
        ]
        
        // In echtem Code: CBOR encoding
        // return try! CBOREncoder().encode(coseKey)
        
        // Für jetzt: Simplified
        return try! JSONSerialization.data(withJSONObject: coseKey)
    }
    
    // MARK: - Client Data
    
    /// Erstellt clientDataJSON für WebAuthn
    static func buildClientDataJSON(
        type: String, // "webauthn.create" oder "webauthn.get"
        challenge: String, // base64url encoded
        origin: String
    ) -> Data {
        let clientData: [String: Any] = [
            "type": type,
            "challenge": challenge,
            "origin": origin,
            "crossOrigin": false
        ]
        
        return try! JSONSerialization.data(withJSONObject: clientData)
    }
    
    // MARK: - Hashing
    
    /// SHA-256 Hash
    static func sha256(_ data: Data) -> Data {
        return Data(SHA256.hash(data: data))
    }
    
    /// SHA-256 Hash einer UTF-8 String
    static func sha256(_ string: String) -> Data {
        guard let data = string.data(using: .utf8) else {
            return Data()
        }
        return sha256(data)
    }
    
    // MARK: - Public Key Extraction
    
    /// Extrahiert Public Key aus PEM-Format zu uncompressed bytes
    static func extractPublicKeyBytes(from pemString: String) -> Data? {
        // Entferne PEM Header/Footer
        let lines = pemString.components(separatedBy: .newlines)
        let base64 = lines
            .filter { !$0.hasPrefix("-----") }
            .joined()
        
        guard let derData = Data(base64Encoded: base64) else {
            return nil
        }
        
        // DER-encoded public key parsen
        // Für EC P-256: Die letzten 65 bytes sind der uncompressed point
        // Format: 0x04 || x (32 bytes) || y (32 bytes)
        
        if derData.count >= 65 {
            return derData.suffix(65)
        }
        
        return nil
    }
    
    // MARK: - Base64URL
    
    /// Konvertiert Base64 zu Base64URL
    static func base64ToBase64URL(_ base64: String) -> String {
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    
    /// Konvertiert Base64URL zu Base64
    static func base64URLToBase64(_ base64url: String) -> String {
        var base64 = base64url
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        
        // Padding hinzufügen
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        
        return base64
    }
}
