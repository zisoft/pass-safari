#!/bin/bash
# Quick Start für PassKey Testing

echo "🚀 PassKey Test - Quick Start"
echo "=============================="
echo ""

# Check if server is already running
if lsof -i :8080 > /dev/null 2>&1; then
    echo "✅ Server läuft bereits auf Port 8080"
else
    echo "🌐 Starte lokalen Webserver..."
    cd ~/src/pass-safari
    python3 -m http.server 8080 > /dev/null 2>&1 &
    SERVER_PID=$!
    echo "✅ Server gestartet (PID: $SERVER_PID)"
    echo "   Zum Stoppen: kill $SERVER_PID"
    echo "   ODER: pkill -f 'python3 -m http.server'"
fi

echo ""
echo "📱 Öffne Safari..."
sleep 1
open http://localhost:8080/passkey-test.html

echo ""
echo "📋 Nächste Schritte:"
echo "   1. Safari DevTools öffnen (⌘⌥I)"
echo "   2. Zum Console Tab wechseln"
echo "   3. Klicke 'Create PassKey' Button"
echo "   4. Beobachte [pass-safari] Logs"
echo ""
echo "✅ Wenn erfolgreich:"
echo "   - Native App startet automatisch"
echo "   - PassKey wird erstellt"
echo "   - Verifiziere mit: pass passkey list"
echo ""
echo "❌ Bei Problemen:"
echo "   - Stelle sicher, dass pass-safari Extension aktiviert ist"
echo "   - Safari → Preferences → Extensions → pass-safari"
echo "   - Reload Extension falls nötig"
echo ""
