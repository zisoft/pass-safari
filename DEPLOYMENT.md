# 🚀 Deployment Guide - PassKey Integration in pass-safari

## ✅ Schritt-für-Schritt Anleitung

### 1️⃣ Pass-Extension permanent installieren

```bash
# Die Extension ist bereits installiert, aber zur Sicherheit:
cd ~/src/pass-passkey
cp passkey.bash /opt/homebrew/lib/password-store/extensions/

# Verifizieren:
pass passkey help
# Sollte die Hilfe anzeigen
```

### 2️⃣ Xcode-Projekt finalisieren

```bash
cd ~/src/pass-safari
open pass-safari.xcodeproj
```

**In Xcode:**
1. **Clean Build Folder** (⇧⌘K)
2. **Build** (⌘B)
3. Prüfe ob keine Fehler auftreten

### 3️⃣ App für normale Nutzung vorbereiten

**Aktuell:** Test-Server nötig (localhost:9000)
**Für echte Websites:** Funktioniert automatisch!

Die grünen "Direct PoC" Buttons funktionieren nur auf der Test-Seite.
Für echte Websites müssten wir die WebAuthn API Integration vervollständigen.

### 4️⃣ Extension in Safari aktivieren

1. **Safari starten**
2. **Safari → Preferences → Extensions**
3. **✅ pass-safari Extension** aktivieren
4. **Permissions prüfen:**
   - "Access to All Websites" ✅
   - "Native Messaging" ✅

### 5️⃣ Testen mit echten Websites (aktuell NICHT möglich)

⚠️ **WICHTIG:** Die PassKey-Integration funktioniert **NUR** mit der Test-Seite!

**Warum?**
- Die WebAuthn API Buttons (blau/grau) sind deaktiviert
- Nur die "Direct PoC" Buttons (grün) funktionieren
- Echte Websites rufen navigator.credentials.create/get() auf
- Das führt zum macOS Keychain Dialog

### 6️⃣ Was JETZT funktioniert:

✅ **Test-Seite (localhost:9000):**
```bash
cd ~/src/pass-safari
python3 -m http.server 9000 &
open http://localhost:9000/passkey-test.html
```

❌ **Echte Websites (z.B. github.com):**
- Funktionieren noch NICHT
- Würden macOS Keychain Dialog zeigen
- Benötigen WebAuthn API Integration

### 7️⃣ Reguläre pass-safari Features nutzen

**Die bestehenden Features funktionieren weiterhin normal:**
- ✅ Passwort-Autofill
- ✅ OTP-Codes
- ✅ Password Generator
- ✅ Entry Management

**PassKey-Features sind ZUSÄTZLICH verfügbar über:**
- CLI: `pass passkey ...`
- Test-Seite: http://localhost:9000/passkey-test.html

## 🔧 Was fehlt für echte Websites?

### Für vollständige WebAuthn-Integration benötigt:

1. **CBOR-Encoding implementieren**
   ```swift
   import PotentCBOR
   
   func buildAttestationObject() -> Data {
       // Korrekte CBOR-Struktur für WebAuthn
   }
   ```

2. **passkey.js anpassen**
   ```javascript
   // Statt Fallback zu Platform Authenticator:
   // → Eigene CBOR-konforme Response bauen
   // → Korrekte authenticatorData
   // → Proper clientDataJSON
   ```

3. **Public Key Format**
   ```swift
   // COSE-Format statt PEM
   func convertToCOSE(publicKey: SecKey) -> Data {
       // COSE encoding
   }
   ```

## 📋 Deployment Checkliste

### Für Test-Nutzung (JETZT):

- [x] pass-passkey Extension installiert
- [x] Xcode Projekt kompiliert
- [x] Safari Extension aktiviert
- [x] Test-Seite funktioniert
- [x] Create Flow funktioniert
- [x] Authenticate Flow funktioniert

### Für Production (TODO):

- [ ] CBOR-Library hinzufügen
- [ ] WebAuthn API vollständig implementieren
- [ ] authenticatorData korrekt aufbauen
- [ ] clientDataJSON Hash berechnen
- [ ] Public Key COSE-Format
- [ ] RP ID Validation
- [ ] Origin Validation
- [ ] UI für Credential-Auswahl
- [ ] Error Handling verbessern
- [ ] Tests auf echten Websites

## 🎯 Empfohlene Nutzung JETZT

### Option 1: CLI-Nutzung

```bash
# PassKeys manuell verwalten
pass passkey add github.com/mario --rp-id=github.com --user-id=mario123 --user-name=mario@github.com
pass passkey list
pass passkey show github.com/mario
```

### Option 2: Test-Seite

```bash
# Server starten
cd ~/src/pass-safari
python3 -m http.server 9000 &

# Browser öffnen
open http://localhost:9000/passkey-test.html

# Testen mit grünen Buttons
```

### Option 3: Integration in pass-safari Popup (TODO)

Könnte in die Extension-UI integriert werden:
- PassKey-Tab im Popup
- Liste der gespeicherten PassKeys
- Manuelles Erstellen/Löschen
- Anzeige von Metadaten

## 🔐 Sicherheitshinweise

### Produktiv-Nutzung:

⚠️ **Der PoC ist NICHT production-ready!**

**Gründe:**
1. Keine WebAuthn-Konformität
2. Keine RP ID Validation
3. Keine Origin Validation
4. Kein Signature Counter
5. Vereinfachte Kryptografie

**Aber:** Die Architektur ist solid!

### Für sichere Nutzung:

✅ **CLI ist sicher:**
```bash
# PassKeys werden korrekt GPG-verschlüsselt
pass passkey add ...
```

✅ **Storage ist sicher:**
- GPG-verschlüsselt
- Git-fähig
- Standard pass-Security

❌ **Browser-Integration nicht production-ready:**
- Nur für Tests/PoC
- Nicht für echte Websites verwenden

## 📝 Nächste Schritte

### Sofort nutzbar:

1. **CLI verwenden:**
   ```bash
   pass passkey add <entry> --rp-id=... --user-id=... --user-name=...
   ```

2. **Test-Seite nutzen:**
   - Für Entwicklung/Tests
   - Zeigt dass es funktioniert

### Für Production:

1. **CBOR-Integration**
   - PotentCBOR hinzufügen
   - Oder: SwiftCBOR
   - attestationObject korrekt bauen

2. **WebAuthn API vervollständigen**
   - passkey.js erweitern
   - Korrekte Response-Objekte
   - Validierung implementieren

3. **UI entwickeln**
   - PassKey-Management
   - Credential-Auswahl
   - User-Bestätigung

## 🎓 Fazit

**Was du JETZT hast:**
- ✅ Vollständiger PoC
- ✅ CLI funktioniert
- ✅ Test-Integration funktioniert
- ✅ Architektur ist bewiesen

**Was für echte Websites fehlt:**
- ❌ WebAuthn-Konformität
- ❌ CBOR-Encoding
- ❌ Production UI

**Aber:** Die Basis ist gelegt und funktioniert! 🚀

---

**Status:** ✅ PoC vollständig funktionsfähig
**Production-Ready:** ⚠️ Nein (siehe TODO)
**Empfehlung:** CLI-Nutzung oder Test-Seite
