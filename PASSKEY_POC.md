# PassKey Support für pass-safari - Proof of Concept

Dieser PoC zeigt, wie PassKeys (WebAuthn) in pass-safari integriert werden können.

## Komponenten

### 1. pass-passkey Extension (`~/src/pass-passkey/`)

Eine Pass-Extension, die PassKey-Credentials verwaltet:

```bash
# Installation
cd ~/src/pass-passkey
cp passkey.bash /opt/homebrew/lib/password-store/extensions/

# Verwendung
pass passkey add GitHub/mario --rp-id=github.com --user-id=mario123 --user-name=mario@example.com
pass passkey list
pass passkey show GitHub/mario
```

**Features:**
- ✅ ES256 (ECDSA P-256) Key-Generierung
- ✅ GPG-verschlüsselte Speicherung
- ✅ JSON-Output für Browser-Integration
- ✅ Challenge-Signierung
- ✅ Git-Integration

### 2. Swift-Erweiterungen (AppDelegate.swift)

Neue Commands in der Native App:
- `listPasskeys` - Alle PassKeys auflisten
- `getPasskeyCredentials` - Credentials für einen Eintrag
- `createPasskey` - Neuen PassKey erstellen
- `authenticatePasskey` - Challenge signieren

### 3. Browser-Extension (JavaScript)

**passkey.js** - WebAuthn API Interception:
- Überschreibt `navigator.credentials.create()`
- Überschreibt `navigator.credentials.get()`
- Kommuniziert mit background.js

**background.js** - Message Handling:
- `passkeyCreate` - PassKey-Registrierung
- `passkeyGet` - PassKey-Authentifizierung

## Architektur

```
Website (WebAuthn API)
         ↓
passkey.js (Content Script)
         ↓
background.js
         ↓
SafariWebExtensionHandler.swift
         ↓
PassRequest-*.plist
         ↓
AppDelegate.swift
         ↓
pass passkey (CLI)
         ↓
~/.password-store/.passkeys/
```

## Testing

1. **Extension installieren:**
   ```bash
   cd ~/src/pass-safari
   open pass-safari.xcodeproj
   # Build und Run (⌘R)
   # Extension in Safari aktivieren
   ```

2. **Test-Seite öffnen:**
   ```bash
   open ~/src/pass-safari/passkey-test.html
   ```

3. **PassKey erstellen:**
   - Klicke auf "Create PassKey"
   - Die Extension sollte die Anfrage abfangen
   - Ein neuer PassKey wird in pass erstellt

4. **Mit PassKey authentifizieren:**
   - Klicke auf "Authenticate"
   - Die Extension verwendet den gespeicherten PassKey
   - Challenge wird signiert

## Limitierungen des PoC

### ✅ Funktioniert:
- Pass-Extension für PassKey-Verwaltung
- Swift-Integration in die Native App
- JavaScript WebAuthn-Interception
- File-basierte Kommunikation

### ⚠️ Vereinfacht (für Production TODO):
1. **CBOR-Encoding fehlt:**
   - `attestationObject` sollte CBOR-encoded sein
   - `authenticatorData` benötigt korrektes Format

2. **Kryptografie:**
   - Signatur-Verifizierung fehlt
   - Public Key muss in COSE-Format konvertiert werden
   - Authenticator Data muss korrekt aufgebaut werden

3. **UI:**
   - Keine Benutzer-Bestätigung für PassKey-Erstellung
   - Keine Credential-Auswahl bei mehreren PassKeys
   - Keine visuelle Rückmeldung

4. **WebAuthn-Compliance:**
   - Client Data Hash muss korrekt berechnet werden
   - RP ID Validation fehlt
   - Origin Validation fehlt
   - Counter-Management fehlt

## Nächste Schritte für Production

### 1. CBOR-Integration

```swift
import PotentCBOR  // oder andere CBOR-Library

func buildAttestationObject(credentialId: String, publicKey: Data) -> Data {
    let authData = buildAuthenticatorData(rpIdHash: ..., credentialId: ..., publicKey: ...)
    let attestationObject: CBOR = [
        "fmt": "none",
        "attStmt": [:],
        "authData": CBOR.byteString(authData)
    ]
    return try! CBOREncoder.encode(attestationObject)
}
```

### 2. UI-Integration

- Popup für PassKey-Erstellung-Bestätigung
- Liste verfügbarer Credentials
- Touch ID / Face ID Integration
- Passkey-Management in der Extension-UI

### 3. WebAuthn-Konformität

- Vollständige Client Data JSON
- RP ID Validation
- Origin Validation
- Signature Counter
- User Verification Flags

### 4. Sicherheit

- Secure Enclave für Private Keys (optional)
- Timeout-Mechanismen
- Rate Limiting
- Audit Logging

## Dependencies für Production

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/outfoxx/PotentCodables", from: "3.0.0"),  // CBOR
    .package(url: "https://github.com/apple/swift-crypto", from: "2.0.0")      // Crypto
]
```

## Beispiel: Vollständige PassKey-Registrierung

```javascript
// 1. Server sendet Challenge
const challenge = await fetch('/auth/register/challenge');

// 2. Browser erstellt PassKey (via pass-safari)
const credential = await navigator.credentials.create({
    publicKey: {
        challenge: challenge.value,
        rp: { name: "Example", id: "example.com" },
        user: {
            id: userId,
            name: "user@example.com",
            displayName: "User"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }]
    }
});

// 3. pass-safari erstellt Credential in pass
// pass passkey add example.com --rp-id=example.com --user-id=... --user-name=...

// 4. Server verifiziert und speichert Public Key
await fetch('/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify({
        id: credential.id,
        response: {
            clientDataJSON: ...,
            attestationObject: ...
        }
    })
});
```

## Testen mit echten Websites

Einige Websites für PassKey-Tests:
- https://webauthn.io/
- https://webauthn.me/
- https://demo.yubico.com/webauthn

**Hinweis:** Der PoC funktioniert nur teilweise mit echten Websites, da CBOR-Encoding und andere WebAuthn-Details fehlen.

## Weitere Ressourcen

- [WebAuthn Spec](https://www.w3.org/TR/webauthn-2/)
- [FIDO Alliance](https://fidoalliance.org/)
- [Apple PassKeys](https://developer.apple.com/passkeys/)
- [pass-otp](https://github.com/tadfisher/pass-otp) - Inspiration

## Lizenz

GPL-3.0 (wie pass und pass-safari)
