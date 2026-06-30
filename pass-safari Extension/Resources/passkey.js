// PassKey/WebAuthn Support for pass-safari
// This script intercepts WebAuthn API calls and handles them via pass-passkey

(function() {
    'use strict';

    // Store original WebAuthn methods
    const originalCreate = navigator.credentials.create;
    const originalGet = navigator.credentials.get;

    // Helper to convert ArrayBuffer to Base64
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // Helper to convert Base64 to ArrayBuffer
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Helper to extract domain from origin
    function extractDomain(origin) {
        try {
            const url = new URL(origin);
            return url.hostname;
        } catch (e) {
            return null;
        }
    }

    // Override navigator.credentials.create
    navigator.credentials.create = async function(options) {
        console.log('[pass-safari] WebAuthn create() called', options);

        if (!options?.publicKey) {
            return originalCreate.call(this, options);
        }

        try {
            // Extract relevant information
            const publicKey = options.publicKey;
            const rpId = publicKey.rp?.id || extractDomain(window.location.origin);
            const rpName = publicKey.rp?.name || rpId;
            const userId = arrayBufferToBase64(publicKey.user.id);
            const userName = publicKey.user.name || publicKey.user.displayName || 'Unknown';
            const challenge = arrayBufferToBase64(publicKey.challenge);

            console.log('[pass-safari] Creating passkey for:', {
                rpId,
                rpName,
                userId,
                userName,
                origin: window.location.origin
            });
            
            // Validate origin
            if (window.location.protocol === 'file:') {
                console.warn('[pass-safari] file:// protocol detected. WebAuthn requires http:// or https://');
                console.warn('[pass-safari] Please use: python3 -m http.server 8080 and open http://localhost:8080/passkey-test.html');
                throw new Error('WebAuthn not supported on file:// URLs. Use http://localhost instead.');
            }

            // Ask user if they want to create via pass-safari
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
                console.log('[pass-safari] PassKey created successfully');
                
                // Build credential response
                const credential = {
                    id: result.credential.credentialId,
                    rawId: base64ToArrayBuffer(result.credential.credentialId),
                    type: 'public-key',
                    response: {
                        clientDataJSON: base64ToArrayBuffer(result.credential.clientDataJSON),
                        attestationObject: base64ToArrayBuffer(result.credential.attestationObject)
                    }
                };

                // Return a PublicKeyCredential-like object
                return credential;
            }

            console.log('[pass-safari] Falling back to platform authenticator');
            // Für PoC: Zeige Fehler statt Fallback
            throw new Error('pass-safari: PassKey creation not yet fully implemented. Native fallback disabled for testing.');
            // return originalCreate.call(this, options);

        } catch (error) {
            console.error('[pass-safari] Error in passkey creation:', error);
            return originalCreate.call(this, options);
        }
    };

    // Override navigator.credentials.get
    navigator.credentials.get = async function(options) {
        console.log('[pass-safari] WebAuthn get() called', options);

        if (!options?.publicKey) {
            return originalGet.call(this, options);
        }

        try {
            const publicKey = options.publicKey;
            const rpId = publicKey.rpId || extractDomain(window.location.origin);
            const challenge = arrayBufferToBase64(publicKey.challenge);
            const allowCredentials = publicKey.allowCredentials?.map(cred => ({
                id: arrayBufferToBase64(cred.id),
                type: cred.type
            })) || [];

            console.log('[pass-safari] Authenticating with passkey for:', {
                rpId,
                allowCredentials
            });

            // Ask pass-safari to authenticate
            const result = await browser.runtime.sendMessage({
                command: 'passkeyGet',
                rpId: rpId,
                challenge: challenge,
                allowCredentials: allowCredentials,
                origin: window.location.origin
            });

            if (result?.handled && result?.assertion) {
                console.log('[pass-safari] PassKey authentication successful');
                
                // Build assertion response
                const assertion = {
                    id: result.assertion.credentialId,
                    rawId: base64ToArrayBuffer(result.assertion.credentialId),
                    type: 'public-key',
                    response: {
                        clientDataJSON: base64ToArrayBuffer(result.assertion.clientDataJSON),
                        authenticatorData: base64ToArrayBuffer(result.assertion.authenticatorData),
                        signature: base64ToArrayBuffer(result.assertion.signature),
                        userHandle: result.assertion.userHandle ? 
                            base64ToArrayBuffer(result.assertion.userHandle) : null
                    }
                };

                return assertion;
            }

            console.log('[pass-safari] Falling back to platform authenticator');
            return originalGet.call(this, options);

        } catch (error) {
            console.error('[pass-safari] Error in passkey authentication:', error);
            return originalGet.call(this, options);
        }
    };

    console.log('[pass-safari] PassKey support initialized');
})();
