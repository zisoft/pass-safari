# 🔑 PassKey CLI Guide - Praktische Nutzung

## Scenario: PassKey für GitHub erstellen

### Schritt 1: PassKey in pass erstellen

```bash
# Syntax:
pass passkey add <entry-name> \
  --rp-id=<domain> \
  --user-id=<deine-user-id> \
  --user-name=<dein-username>

# Beispiel für GitHub:
pass passkey add GitHub/mario-passkey \
  --rp-id=github.com \
  --user-id=mario123 \
  --user-name=mario@example.com
```

**Was passiert:**
- ✅ ES256 Private/Public Key Pair wird generiert
- ✅ GPG-verschlüsselt in `~/.password-store/.passkeys/GitHub/mario-passkey/*.gpg`
- ✅ Git Commit wird automatisch erstellt

### Schritt 2: Public Key extrahieren

```bash
# Public Key anzeigen
pass passkey show GitHub/mario-passkey --json | jq -r '.[0].publicKey'
```

**Output:**
```
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7TENcos1/hgUPS3b7ukXxYnyIQHF
96b+w0hVimtwg9od4r/zl3Mq450KwK7q4PCYqp63ls6T0m8LjBxo7rddMg==
-----END PUBLIC KEY-----
```

### Schritt 3: Credential ID anzeigen

```bash
# Credential ID extrahieren
pass passkey show GitHub/mario-passkey --json | jq -r '.[0].credentialId'
```

**Output:**
```
c55a969e451c79b8581cf300bc9012d0
```

---

## ⚠️ PROBLEM: Website-Integration

### Was fehlt?

**Der CLI-Weg kann PassKeys erstellen und verwalten, ABER:**

❌ Die Website weiß nichts davon
❌ Kein automatisches Registrieren des Public Keys auf der Website
❌ Kein automatisches Authentifizieren

### Warum?

PassKeys sind ein **2-Seiten-Protokoll:**

```
┌─────────────────┐           ┌─────────────────┐
│   Browser       │  ◄─────►  │   Website       │
│  (Client)       │           │   (Server)      │
└─────────────────┘           └─────────────────┘
        │                              │
        │ 1. Challenge                │
        │ ◄──────────────────────────┤
        │                              │
        │ 2. Sign Challenge            │
        │    mit Private Key          │
        │                              │
        │ 3. Signature + Public Key    │
        │ ├──────────────────────────►│
        │                              │
        │                        4. Verifiziert
        │                           Signature
```

**CLI allein kann nur:**
- ✅ Private Key erstellen
- ✅ Public Key extrahieren
- ✅ Challenge signieren

**CLI kann NICHT:**
- ❌ Mit Website kommunizieren
- ❌ Challenge von Website empfangen
- ❌ Automatisch registrieren

---

## 💡 Praktische Nutzung JETZT

### Option 1: Manueller Workflow (Fortgeschritten)

**Für Entwickler/Tester:**

1. **PassKey erstellen:**
   ```bash
   pass passkey add test/mysite --rp-id=example.com --user-id=user123 --user-name=test@example.com
   ```

2. **Public Key extrahieren:**
   ```bash
   pass passkey show test/mysite --json | jq '.[0]'
   ```

3. **Manuell auf Website registrieren:**
   - API-Call an `/webauthn/register`
   - Public Key manuell übergeben
   - Nur für eigene Websites/Tests möglich

### Option 2: Backup/Recovery (Praktisch!)

**Szenario:** Du hast bereits PassKeys in macOS Keychain

```bash
# 1. PassKey-Metadaten in pass speichern (als Backup)
pass insert -m GitHub/passkey-backup
# Eingeben:
# Service: GitHub
# Created: 2026-06-30
# User: mario@example.com
# Device: MacBook Pro
# Note: Stored in iCloud Keychain
```

**Vorteil:**
- ✅ Dokumentation deiner PassKeys
- ✅ Backup der Metadaten
- ✅ Git-Sync deiner PassKey-Liste
- ✅ Wiederherstellung nach Geräteverlust

### Option 3: Als Entwickler-Tool

**Für eigene Websites/Apps:**

```bash
# 1. PassKey erstellen
pass passkey add myapp/testuser \
  --rp-id=myapp.local \
  --user-id=test-user-1 \
  --user-name=test@example.com

# 2. In eigener App: Pass CLI aufrufen
# Deine App kann pass passkey sign aufrufen
challenge="abc123def456"
credential_id=$(pass passkey show myapp/testuser --json | jq -r '.[0].credentialId')

signature=$(pass passkey sign myapp/testuser "$credential_id" "$challenge")
echo "Signature: $signature"
```

---

## 🎯 Realistische Nutzungs-Szenarien

### Szenario A: PassKey-Inventar

**Nutze pass als PassKey-Datenbank:**

```bash
# Alle deine PassKeys dokumentieren
pass passkey add GitHub/mario --rp-id=github.com --user-id=... --user-name=...
pass passkey add Google/mario --rp-id=google.com --user-id=... --user-name=...
pass passkey add Microsoft/mario --rp-id=microsoft.com --user-id=... --user-name=...

# Liste anzeigen
pass passkey list

# Output:
# GitHub (1 credentials)
# Google (1 credentials)
# Microsoft (1 credentials)
```

**Git-Sync:**
```bash
cd ~/.password-store
git push
# Jetzt hast du deine PassKey-Liste auf allen Geräten!
```

### Szenario B: Entwicklung/Testing

**Für eigene WebAuthn-Implementierung:**

```bash
# Test-Credentials erstellen
for i in {1..5}; do
  pass passkey add test/user$i \
    --rp-id=localhost \
    --user-id=user-$i \
    --user-name=user$i@test.local
done

# In deiner Test-App:
pass passkey show test/user1 --json | jq '.[0].publicKey'
# Public Key in Test-DB einfügen
```

### Szenario C: Notfall-Recovery

**PassKey-Backup für den Notfall:**

```bash
# Nach PassKey-Erstellung auf einer Website:
pass insert -m GitHub/passkey-main << EOF
Service: GitHub
Credential ID: (aus Browser DevTools extrahieren)
Created: $(date)
Device: MacBook Pro
Location: iCloud Keychain
Backup: $(pass passkey add GitHub/passkey-backup --rp-id=github.com ...)
EOF
```

---

## 📊 Vergleich: CLI vs. Browser-Integration

| Feature | CLI (JETZT) | Browser (PoC) | Production |
|---------|------------|---------------|------------|
| PassKey erstellen | ✅ | ✅ | ⏳ |
| PassKey speichern | ✅ | ✅ | ⏳ |
| Challenge signieren | ✅ | ✅ | ⏳ |
| Website-Kommunikation | ❌ | ⚠️ (nur Test) | ⏳ |
| Auto-Register | ❌ | ❌ | ⏳ |
| Auto-Login | ❌ | ❌ | ⏳ |
| Backup/Sync | ✅ | ✅ | ✅ |
| Metadaten-Verwaltung | ✅ | ✅ | ✅ |

---

## 🔧 Praktisches Beispiel

### Komplett-Workflow (für eigene Website):

```bash
# 1. PassKey erstellen
pass passkey add mysite/mario \
  --rp-id=mysite.com \
  --user-id=mario-uuid-123 \
  --user-name=mario@mysite.com

# 2. Public Key extrahieren
PUBLIC_KEY=$(pass passkey show mysite/mario --json | jq -r '.[0].publicKey')

# 3. Credential ID extrahieren
CRED_ID=$(pass passkey show mysite/mario --json | jq -r '.[0].credentialId')

# 4. An eigene API senden (manuell)
curl -X POST https://mysite.com/api/webauthn/register \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "mario-uuid-123",
    "credentialId": "'$CRED_ID'",
    "publicKey": "'$PUBLIC_KEY'"
  }'

# 5. Bei Login: Challenge signieren
CHALLENGE=$(curl https://mysite.com/api/webauthn/challenge)
SIGNATURE=$(pass passkey sign mysite/mario "$CRED_ID" "$CHALLENGE")

# 6. Signature an API senden
curl -X POST https://mysite.com/api/webauthn/verify \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "'$CRED_ID'",
    "challenge": "'$CHALLENGE'",
    "signature": "'$SIGNATURE'"
  }'
```

---

## ✅ FAZIT

### Was du JETZT tun kannst:

1. **PassKeys in pass verwalten:**
   ```bash
   pass passkey add <service> --rp-id=... --user-id=... --user-name=...
   pass passkey list
   pass passkey show <service>
   ```

2. **Als Backup nutzen:**
   - Metadaten deiner echten PassKeys speichern
   - Git-Sync für Redundanz

3. **Für Entwicklung:**
   - Test-Credentials erstellen
   - Eigene WebAuthn-Integration testen

### Was NOCH NICHT geht:

❌ Automatische Integration mit echten Websites (GitHub, Google, etc.)
❌ Browser-basiertes Login
❌ Vollautomatischer Workflow

### Für vollständige Website-Integration:

⏳ Benötigt komplette WebAuthn Browser-Integration (siehe WEBAUTHN_INTEGRATION.md)

---

**Status:** CLI vollständig funktionsfähig für Verwaltung & Entwicklung ✅
**Website-Integration:** Benötigt CBOR + WebAuthn-Konformität ⏳
