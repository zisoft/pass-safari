# 🔧 WebAuthn Integration - Schritt-für-Schritt

## Übersicht

Um PassKeys auf echten Websites zum Laufen zu bringen, müssen wir:

1. ✅ CBOR-Library hinzufügen (Package.swift erstellt)
2. ✅ WebAuthnHelper.swift erstellt
3. ⏳ Xcode-Projekt aktualisieren
4. ⏳ AppDelegate.swift erweitern
5. ⏳ passkey.js vervollständigen
6. ⏳ Testen auf echten Websites

## Schritt 1: Xcode-Projekt vorbereiten

### A) Package.swift zu Xcode hinzufügen

```
1. Öffne pass-safari.xcodeproj in Xcode
2. File → Add Files to "pass-safari"...
3. Wähle Package.swift
4. ✅ Add to targets: pass-safari
5. Click "Add"
```

### B) WebAuthnHelper.swift hinzufügen

```
1. Im Project Navigator: Rechtsklick auf "pass-safari" Ordner
2. Add Files to "pass-safari"...
3. Wähle WebAuthnHelper.swift
4. ✅ Add to targets: pass-safari
5. Click "Add"
```

### C) Swift Package Dependencies hinzufügen

```
1. Xcode → File → Add Packages...
2. URL: https://github.com/outfoxx/PotentCodables.git
3. Dependency Rule: Up to Next Major Version 3.2.0
4. Add Package
5. ✅ PotentCBOR zu pass-safari target hinzufügen
```

## Schritt 2: AppDelegate.swift erweitern

Die createPasskey() Funktion muss WebAuthn-konforme Daten zurückgeben:

```swift
private func createPasskey(
    for entryName: String,
    rpId: String,
    userId: String,
    userName: String,
    configuration: StoreConfiguration
) throws -> [String: Any] {
    // 1. Passkey erstellen (wie bisher)
    let output = try runPass(
        arguments: [
            "passkey", "add", entryName,
            "--rp-id=\(rpId)",
            "--user-id=\(userId)",
            "--user-name=\(userName)"
        ],
        configuration: configuration
    )
    
    // 2. Credential ID extrahieren
    let lines = output.components(separatedBy: .newlines)
    guard let credLine = lines.first(where: { $0.hasPrefix("Added passkey credential ") }),
          let credentialId = credLine.components(separatedBy: " ").dropFirst(3).first else {
        throw PassError.executionFailed("Failed to extract credential ID")
    }
    
    // 3. Public Key laden
    let showOutput = try runPass(
        arguments: ["passkey", "show", entryName, "--json"],
        configuration: configuration
    )
    
    guard let data = showOutput.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
          let credential = json.first(where: { ($0["credentialId"] as? String) == credentialId }),
          let publicKeyPEM = credential["publicKey"] as? String else {
        throw PassError.executionFailed("Failed to load public key")
    }
    
    // 4. WebAuthn-konforme Response bauen
    guard let publicKeyBytes = WebAuthnHelper.extractPublicKeyBytes(from: publicKeyPEM) else {
        throw PassError.executionFailed("Failed to extract public key bytes")
    }
    
    let rpIdHash = WebAuthnHelper.sha256(rpId)
    let credentialIdData = credentialId.data(using: .utf8) ?? Data()
    
    let attestationObject = WebAuthnHelper.buildAttestationObject(
        rpIdHash: rpIdHash,
        credentialId: credentialIdData,
        publicKeyBytes: publicKeyBytes
    )
    
    return [
        "credentialId": credentialId,
        "attestationObject": attestationObject.base64EncodedString(),
        "publicKeyBytes": publicKeyBytes.base64EncodedString()
    ]
}
```

## Schritt 3: passkey.js vervollständigen

Die Datei passkey.js muss vollständige WebAuthn Credentials bauen:

```javascript
navigator.credentials.create = async function(options) {
    if (!options?.publicKey) {
        return originalCreate.call(this, options);
    }

    try {
        const publicKey = options.publicKey;
        const rpId = publicKey.rp?.id || extractDomain(window.location.origin);
        const rpName = publicKey.rp?.name || rpId;
        const userId = arrayBufferToBase64(publicKey.user.id);
        const userName = publicKey.user.name;
        const challenge = arrayBufferToBase64(publicKey.challenge);

        // Request an background.js
        const result = await browser.runtime.sendMessage({
            command: 'passkeyCreate',
            rpId: rpId,
            rpName: rpName,
            userId: userId,
            userName: userName,
            challenge: challenge,
            origin: window.location.origin
        });

        if (result?.handled && result?.credential) {
            // WebAuthn Credential bauen
            const credentialId = result.credential.credentialId;
            const attestationObject = base64ToArrayBuffer(
                result.credential.attestationObject
            );
            
            // Client Data JSON bauen
            const clientData = {
                type: 'webauthn.create',
                challenge: challenge,
                origin: window.location.origin,
                crossOrigin: false
            };
            const clientDataJSON = new TextEncoder().encode(
                JSON.stringify(clientData)
            );

            // PublicKeyCredential Objekt zurückgeben
            return {
                id: credentialId,
                rawId: new TextEncoder().encode(credentialId).buffer,
                type: 'public-key',
                response: {
                    clientDataJSON: clientDataJSON,
                    attestationObject: attestationObject
                },
                getClientExtensionResults: () => ({})
            };
        }

        // Fallback zu Platform Authenticator
        return originalCreate.call(this, options);

    } catch (error) {
        console.error('[pass-safari] Error:', error);
        return originalCreate.call(this, options);
    }
};
```

## Schritt 4: Schrittweise Integration

### Phase 1: Basis-Setup (JETZT)

```bash
# 1. Dateien zu Xcode hinzufügen
cd ~/src/pass-safari
open pass-safari.xcodeproj

# Dann in Xcode:
# - Package.swift hinzufügen
# - WebAuthnHelper.swift hinzufügen
# - PotentCBOR Package hinzufügen
```

### Phase 2: Build & Test (NÄCHSTER SCHRITT)

```bash
# 1. Build in Xcode (⌘B)
# 2. Fehler beheben falls vorhanden
# 3. Test auf localhost:9000
```

### Phase 3: AppDelegate anpassen

- createPasskey() erweitern
- authenticatePasskey() erweitern
- WebAuthnHelper nutzen

### Phase 4: Browser-Integration

- passkey.js vervollständigen
- background.js anpassen
- Korrekte Credential-Objekte

### Phase 5: Testing

- Test auf webauthn.io
- Test auf demo.yubico.com
- Test auf echten Websites

## Wichtige Hinweise

### CBOR vs. JSON

⚠️ **Aktuell:** WebAuthnHelper nutzt noch JSON statt CBOR!

Für echte Websites MUSS CBOR verwendet werden:

```swift
import PotentCBOR

let attestationObject: CBOR = .map([
    "fmt": .utf8String("none"),
    "attStmt": .map([:]),
    "authData": .byteString(authData)
])

return try CBOREncoder().encode(attestationObject)
```

### Public Key Format

Das Public Key muss in **COSE-Format** encodiert werden:

```swift
let coseKey: CBOR = .map([
    .integer(1): .integer(2),              // kty: EC2
    .integer(3): .integer(-7),             // alg: ES256
    .integer(-1): .integer(1),             // crv: P-256
    .integer(-2): .byteString(xCoord),     // x
    .integer(-3): .byteString(yCoord)      // y
])
```

### Signature Format

Bei Authentication muss die Signatur im **DER-Format** sein (nicht raw):

```bash
# In pass-passkey/passkey.bash:
openssl dgst -sha256 -sign <(echo "$private_key") | base64
# Das ist bereits korrekt!
```

## Nächste Schritte

1. [ ] Xcode-Projekt aktualisieren (Dateien hinzufügen)
2. [ ] PotentCBOR Package installieren
3. [ ] Build testen
4. [ ] AppDelegate.swift anpassen
5. [ ] passkey.js vervollständigen
6. [ ] Auf webauthn.io testen
7. [ ] Auf echter Website testen (z.B. GitHub)

## Komplexität

⚠️ **Das ist komplex!** Aber machbar.

**Einfacher Weg:** Nutze CLI für PassKey-Verwaltung
**Vollständiger Weg:** Implementiere komplette WebAuthn-Konformität

Die Architektur ist da, der PoC funktioniert - jetzt geht es um die Details! 🚀

