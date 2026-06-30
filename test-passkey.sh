#!/bin/bash
# PassKey PoC - Quick Test Script

echo "🔐 PassKey Integration - Quick Test"
echo "===================================="
echo ""

# 1. Check if pass-passkey is installed
echo "1️⃣  Checking pass-passkey installation..."
if pass passkey help &>/dev/null; then
    echo "   ✅ pass-passkey is installed"
else
    echo "   ❌ pass-passkey not found!"
    echo "   Installing..."
    cp ~/src/pass-passkey/passkey.bash /opt/homebrew/lib/password-store/extensions/
    echo "   ✅ Installed!"
fi
echo ""

# 2. Check if test credential exists
echo "2️⃣  Checking for test credentials..."
if pass passkey list 2>/dev/null | grep -q "test"; then
    echo "   ✅ Test credentials exist"
    pass passkey list
else
    echo "   Creating test credential..."
    pass passkey add test/demo \
        --rp-id=localhost \
        --user-id=demo123 \
        --user-name=demo@example.com
    echo "   ✅ Created!"
fi
echo ""

# 3. Show credentials
echo "3️⃣  Test credential details:"
pass passkey show test/demo
echo ""

# 4. List all PassKeys as JSON
echo "4️⃣  All PassKeys (JSON):"
pass passkey list --json | jq .
echo ""

# 5. Test signature
echo "5️⃣  Testing signature generation..."
CRED_ID=$(pass passkey show test/demo --json | jq -r '.[0].credentialId')
if [ -n "$CRED_ID" ]; then
    echo "   Credential ID: $CRED_ID"
    SIGNATURE=$(pass passkey sign test/demo "$CRED_ID" "test-challenge-123")
    echo "   Signature: ${SIGNATURE:0:50}..."
    echo "   ✅ Signature generated!"
else
    echo "   ❌ Could not get credential ID"
fi
echo ""

# 6. Instructions for browser test
echo "6️⃣  Browser Test Instructions:"
echo "   1. Build pass-safari in Xcode:"
echo "      cd ~/src/pass-safari"
echo "      open pass-safari.xcodeproj"
echo "      # Press ⌘R to build and run"
echo ""
echo "   2. Enable extension in Safari:"
echo "      Safari → Preferences → Extensions"
echo "      ✅ Enable 'pass-safari Extension'"
echo ""
echo "   3. Open test page:"
echo "      open ~/src/pass-safari/passkey-test.html"
echo ""
echo "   4. Open DevTools:"
echo "      Safari → Develop → Show JavaScript Console"
echo ""
echo "   5. Click 'Create PassKey' button and watch console"
echo ""

# 7. Show file structure
echo "7️⃣  PassKey Storage:"
echo "   ~/.password-store/.passkeys/"
find ~/.password-store/.passkeys -name "*.gpg" 2>/dev/null | head -5
echo ""

echo "✅ Quick test complete!"
echo ""
echo "📚 Documentation:"
echo "   - PASSKEY_SUMMARY.md - Quick overview"
echo "   - PASSKEY_POC.md - Full documentation"
echo "   - CHANGES.md - Code changes"
