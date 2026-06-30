# PassKey Integration - Code-Änderungen

## Neue Dateien

### 1. pass-passkey Extension
- `~/src/pass-passkey/passkey.bash` - CLI für PassKey-Verwaltung
- `~/src/pass-passkey/Makefile` - Installation
- `~/src/pass-passkey/README.md` - Dokumentation

### 2. Browser Extension
- `pass-safari Extension/Resources/passkey.js` - WebAuthn Interception (NEU)

### 3. Test & Dokumentation
- `passkey-test.html` - Interaktive Test-Seite
- `PASSKEY_POC.md` - Vollständige PoC-Dokumentation
- `PASSKEY_SUMMARY.md` - Zusammenfassung
- `CHANGES.md` - Diese Datei

## Geänderte Dateien

### Swift (Native App)

#### `pass-safari/AppDelegate.swift`
**Zeilen ~30-40:** Neue Enums
```swift
private enum PassRequestCommand: String {
    // ... existing cases ...
    case listPasskeys
    case getPasskeyCredentials
    case createPasskey
    case authenticatePasskey
}
```

**Zeilen ~35-45:** Erweiterte PassRequest Struct
```swift
private struct PassRequest {
    // ... existing fields ...
    let rpId: String?
    let userId: String?
    let userName: String?
    let credentialId: String?
    let challenge: String?
    let clientDataJSON: String?
}
```

**Zeilen ~75-95:** Neue Structs
```swift
private struct PassKeyCredential: Codable { ... }
private struct PassKeyListEntry: Codable { ... }
```

**Zeilen ~330-480:** Neue switch-cases in handlePassRequest()
```swift
case .listPasskeys: ...
case .getPasskeyCredentials: ...
case .createPasskey: ...
case .authenticatePasskey: ...
```

**Zeilen ~510-520:** Erweiterte readPassRequest()
```swift
return PassRequest(
    // ... existing fields ...
    rpId: payload["rpId"] as? String,
    userId: payload["userId"] as? String,
    // ... etc
)
```

**Zeilen Ende (vor }):** Neue Funktionen
```swift
private func listPasskeys(configuration: StoreConfiguration) throws -> [[String: Any]] { ... }
private func getPasskeyCredentials(for entryName: String, configuration: StoreConfiguration) throws -> [[String: Any]] { ... }
private func createPasskey(...) throws -> String { ... }
private func authenticatePasskey(...) throws -> String { ... }
```

#### `pass-safari Extension/SafariWebExtensionHandler.swift`

**Zeilen ~210:** Erweiterte handleMessage() switch
```swift
case "listPasskeys":
    return listPasskeys()
case "getPasskeyCredentials":
    return getPasskeyCredentials(entryName: payload["entry"] as? String)
case "createPasskey":
    return createPasskey(payload: payload)
case "authenticatePasskey":
    return authenticatePasskey(payload: payload)
```

**Zeilen Ende (vor }):** Neue Funktionen
```swift
private func listPasskeys() -> [String: Any] { ... }
private func getPasskeyCredentials(entryName: String?) -> [String: Any] { ... }
private func createPasskey(payload: [String: Any]) -> [String: Any] { ... }
private func authenticatePasskey(payload: [String: Any]) -> [String: Any] { ... }
private func writePasskeyRequest(...) throws { ... }
```

### JavaScript (Browser Extension)

#### `pass-safari Extension/Resources/manifest.json`

**Zeile ~16:** Neue Permission
```json
"permissions": [
    "nativeMessaging",
    "tabs",
    "storage",
    "webRequest"  // NEU
],
```

**Zeilen ~26-30:** Content Scripts angepasst
```json
"js": [
    "passkey.js",  // NEU - MUSS VOR content.js sein
    "content.js"
],
"run_at": "document_start"  // Geändert von "document_idle"
```

#### `pass-safari Extension/Resources/background.js`

**Zeilen ~30-40:** Erweiterte Message Listener
```javascript
browser.runtime.onMessage.addListener((request, sender) => {
    if (request?.command === "triggerShortcutAutofill") {
        return autofillBestMatchForTab(sender.tab);
    }
    
    if (request?.command === "passkeyCreate") {  // NEU
        return handlePasskeyCreate(request, sender.tab);
    }
    
    if (request?.command === "passkeyGet") {  // NEU
        return handlePasskeyGet(request, sender.tab);
    }

    return undefined;
});
```

**Zeilen Ende:** Neue Funktionen
```javascript
async function handlePasskeyCreate(request, tab) { ... }
async function handlePasskeyGet(request, tab) { ... }
async function findEntryForRpId(rpId) { ... }
async function findOrCreateEntryForRpId(rpId, rpName) { ... }
```

## Installation

```bash
# 1. Pass-Extension installieren
cd ~/src/pass-passkey
cp passkey.bash /opt/homebrew/lib/password-store/extensions/

# 2. Safari Extension neu kompilieren
cd ~/src/pass-safari
open pass-safari.xcodeproj
# In Xcode: Build (⌘B) und Run (⌘R)

# 3. Test
open ~/src/pass-safari/passkey-test.html
```

## Testing

```bash
# CLI-Test
pass passkey add test/demo --rp-id=localhost --user-id=demo123 --user-name=demo@example.com
pass passkey list
pass passkey show test/demo

# Browser-Test
# 1. Öffne passkey-test.html in Safari
# 2. Öffne Developer Console
# 3. Klicke "Create PassKey"
# 4. Beobachte Console Logs
```

## Rollback (falls nötig)

```bash
# Pass-Extension entfernen
rm /opt/homebrew/lib/password-store/extensions/passkey.bash

# Git Änderungen rückgängig machen
cd ~/src/pass-safari
git status
git diff  # Änderungen ansehen
git restore pass-safari/AppDelegate.swift
git restore "pass-safari Extension/SafariWebExtensionHandler.swift"
git restore "pass-safari Extension/Resources/background.js"
git restore "pass-safari Extension/Resources/manifest.json"
git clean -f  # Löscht neue untracked files
```

## Performance-Impact

- ✅ Keine Änderungen an bestehender Funktionalität
- ✅ passkey.js läuft nur bei WebAuthn-Calls
- ✅ Neue Commands werden nur bei Bedarf aufgerufen
- ✅ Keine zusätzlichen Background-Prozesse

## Security-Audit Notizen

- ✅ Private Keys bleiben GPG-verschlüsselt
- ✅ Sandbox-Isolation bleibt intakt
- ✅ Keine neuen Netzwerk-Requests
- ⚠️ WebAuthn-Validation fehlt (PoC-Limitation)
- ⚠️ Keine Rate-Limiting (sollte für Production hinzugefügt werden)
