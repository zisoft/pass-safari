const NATIVE_APP_IDS = [
    "de.zisoft.pass-safari",
    "de.zisoft.pass-safari.Extension",
];

const tabsAPI = typeof browser !== 'undefined' ? browser.tabs : chrome.tabs;

function handleUrlChange(url, tabId) {
    if (!url) return;
    
    // Ignoriere Safari-interne Seiten (z.B. Favoriten/Leerer Tab)
    if (url.startsWith('favorites://') || url.startsWith('safari-')) {
        return;
    }
    
    setBadgeCountForTab(url, tabId);
}

tabsAPI.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        handleUrlChange(changeInfo.url, tabId);
    }
});

tabsAPI.onActivated.addListener((activeInfo) => {
    tabsAPI.get(activeInfo.tabId, (tab) => {
        if (tab && tab.url) {
            handleUrlChange(tab.url, tab.id);
        }
    });
});

browser.runtime.onMessage.addListener((request, sender) => {
    if (request?.command === "triggerShortcutAutofill") {
        return autofillBestMatchForTab(sender.tab);
    }
    
    if (request?.command === "passkeyCreate") {
        return handlePasskeyCreate(request, sender.tab);
    }
    
    if (request?.command === "passkeyGet") {
        return handlePasskeyGet(request, sender.tab);
    }
    
    // Direct PassKey commands (from content script)
    if (request?.command === "createPasskey") {
        return handleDirectPasskeyCreate(request);
    }
    
    if (request?.command === "authenticatePasskey") {
        return handleDirectPasskeyAuth(request);
    }
    
    if (request?.command === "listPasskeys") {
        return handleListPasskeys();
    }

    return undefined;
});

async function setBadgeCountForTab(pageURL, tabId) {
    const listResponse = await sendNativeMessage({
        command: "listEntries",
        pageURL,
    });

    if (!listResponse?.ok) {
        throw new Error(listResponse?.error || "Unable to inspect pass entries for this page.");
    }

    if (listResponse.suggestedEntries) {
        const count = `${listResponse.suggestedEntries.length}`;
        
        if (typeof browser !== 'undefined' && browser.action) {
            browser.action.setBadgeText({ text: count, tabId: tabId });
            browser.action.setBadgeBackgroundColor({ color: "#FF0000" }); // Optional: Hintergrundfarbe (z.B. Rot)
        }
        else if (typeof chrome !== 'undefined' && chrome.action) {
            chrome.action.setBadgeText({ text: count, tabId: tabId });
        }
        else if (typeof browser !== 'undefined' && browser.browserAction) {
            browser.browserAction.setBadgeText({ text: count, tabId: tabId });
        }
    }
}

async function autofillBestMatchForTab(tab) {
    const tabId = tab?.id;
    const pageURL = typeof tab?.url === "string" ? tab.url : "";
    
    if (!tabId || !pageURL) {
        return { ok: false, error: "Unable to find the active page for autofill." };
    }

    const listResponse = await sendNativeMessage({
        command: "listEntries",
        pageURL,
    });

    if (!listResponse?.ok) {
        throw new Error(listResponse?.error || "Unable to inspect pass entries for this page.");
    }
    
    const entry = typeof listResponse.shortcutMatchEntry === "string"
        ? listResponse.shortcutMatchEntry
        : null;

    if (!entry) {
        await tryOpenPopup();
        return {
            ok: false,
            openedPopup: true,
            error: "No unambiguous match was found for this page.",
        };
    }

    const detailsResponse = await sendNativeMessage({
        command: "getEntryDetails",
        entry,
    });

    if (!detailsResponse?.ok) {
        throw new Error(detailsResponse?.error || "Unable to load the matched pass entry.");
    }

    return sendMessageToTab(tabId, {
        command: "autofillEntry",
        entry,
        password: typeof detailsResponse.password === "string" ? detailsResponse.password : "",
        username: typeof detailsResponse.username === "string" ? detailsResponse.username : "",
        otp: typeof detailsResponse.otp === "string" ? detailsResponse.otp : "",
        url: typeof detailsResponse.url === "string" ? detailsResponse.url : "",
    });
}

async function tryOpenPopup() {
    try {
        if (globalThis.browser?.action?.openPopup) {
            await globalThis.browser.action.openPopup();
            return true;
        }

        if (globalThis.chrome?.action?.openPopup) {
            await globalThis.chrome.action.openPopup();
            return true;
        }
    } catch (error) {
        console.warn("Unable to open popup after shortcut autofill lookup.", error);
    }

    return false;
}

async function sendNativeMessage(message) {
    let lastError;

    for (const applicationId of NATIVE_APP_IDS) {
        try {
            return await sendNativeMessageToApp(applicationId, message);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("Unable to connect to the native extension handler.");
}

async function sendNativeMessageToApp(applicationId, message) {
    if (globalThis.browser?.runtime?.sendNativeMessage) {
        return globalThis.browser.runtime.sendNativeMessage(applicationId, message);
    }

    if (globalThis.chrome?.runtime?.sendNativeMessage) {
        return new Promise((resolve, reject) => {
            globalThis.chrome.runtime.sendNativeMessage(applicationId, message, (response) => {
                const runtimeError = globalThis.chrome.runtime?.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }

                resolve(response);
            });
        });
    }

    throw new Error("Native messaging is not available in this browser.");
}

async function sendMessageToTab(tabId, message) {
    if (globalThis.browser?.tabs?.sendMessage) {
        return globalThis.browser.tabs.sendMessage(tabId, message);
    }

    if (globalThis.chrome?.tabs?.sendMessage) {
        return new Promise((resolve, reject) => {
            globalThis.chrome.tabs.sendMessage(tabId, message, (response) => {
                const runtimeError = globalThis.chrome.runtime?.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }

                resolve(response);
            });
        });
    }

    throw new Error("Tab messaging is not available in this browser.");
}

// MARK: - PassKey Support

async function handlePasskeyCreate(request, tab) {
    try {
        const { rpId, rpName, userId, userName, challenge, origin } = request;
        
        console.log('[pass-safari] Creating passkey:', { rpId, userName });
        
        // Find or create entry name based on rpId
        const entryName = await findOrCreateEntryForRpId(rpId, rpName);
        
        if (!entryName) {
            return { handled: false, error: 'User cancelled' };
        }
        
        // Create passkey via native app
        const response = await sendNativeMessage({
            command: 'createPasskey',
            entry: entryName,
            rpId: rpId,
            userId: userId,
            userName: userName
        });
        
        if (!response?.ok) {
            throw new Error(response?.error || 'Failed to create passkey');
        }
        
        // Build WebAuthn credential response
        // Note: This is a simplified version. A complete implementation would need:
        // - Proper CBOR encoding of attestationObject
        // - Correct clientDataJSON with hash
        // - Public key in proper format
        
        const clientData = {
            type: 'webauthn.create',
            challenge: challenge,
            origin: origin,
            crossOrigin: false
        };
        
        const clientDataJSON = btoa(JSON.stringify(clientData));
        
        // Simplified attestation object (in real implementation, use CBOR)
        const attestationObject = btoa(JSON.stringify({
            fmt: 'none',
            attStmt: {},
            authData: response.credentialId // Simplified
        }));
        
        return {
            handled: true,
            credential: {
                credentialId: response.credentialId,
                clientDataJSON: clientDataJSON,
                attestationObject: attestationObject
            }
        };
        
    } catch (error) {
        console.error('[pass-safari] Error creating passkey:', error);
        return { handled: false, error: error.message };
    }
}

async function handlePasskeyGet(request, tab) {
    try {
        const { rpId, challenge, allowCredentials, origin } = request;
        
        console.log('[pass-safari] Authenticating with passkey:', { rpId });
        
        // Find entry for rpId
        const entryName = await findEntryForRpId(rpId);
        
        if (!entryName) {
            return { handled: false, error: 'No passkey found for this site' };
        }
        
        // Get credentials for this entry
        const credentialsResponse = await sendNativeMessage({
            command: 'getPasskeyCredentials',
            entry: entryName
        });
        
        if (!credentialsResponse?.ok || !credentialsResponse.credentials?.length) {
            return { handled: false, error: 'No credentials found' };
        }
        
        // Select credential (for now, just use the first one)
        const credential = credentialsResponse.credentials[0];
        
        // Sign challenge
        const signResponse = await sendNativeMessage({
            command: 'authenticatePasskey',
            entry: entryName,
            credentialId: credential.credentialId,
            challenge: challenge
        });
        
        if (!signResponse?.ok) {
            throw new Error(signResponse?.error || 'Failed to sign challenge');
        }
        
        // Build WebAuthn assertion response
        const clientData = {
            type: 'webauthn.get',
            challenge: challenge,
            origin: origin,
            crossOrigin: false
        };
        
        const clientDataJSON = btoa(JSON.stringify(clientData));
        
        // Simplified authenticatorData (in real implementation, use proper format)
        const authenticatorData = btoa(rpId); // Simplified
        
        return {
            handled: true,
            assertion: {
                credentialId: credential.credentialId,
                clientDataJSON: clientDataJSON,
                authenticatorData: authenticatorData,
                signature: signResponse.signature,
                userHandle: credential.userId
            }
        };
        
    } catch (error) {
        console.error('[pass-safari] Error authenticating with passkey:', error);
        return { handled: false, error: error.message };
    }
}

async function findEntryForRpId(rpId) {
    // List all passkeys
    const response = await sendNativeMessage({
        command: 'listPasskeys'
    });
    
    if (!response?.ok || !response.passkeys?.length) {
        return null;
    }
    
    // Find entry matching rpId
    // The entry name might be like "GitHub/mario" for rpId "github.com"
    // We need to search through entries and check their credentials
    
    for (const passkeyEntry of response.passkeys) {
        const credentialsResponse = await sendNativeMessage({
            command: 'getPasskeyCredentials',
            entry: passkeyEntry.entry
        });
        
        if (credentialsResponse?.ok && credentialsResponse.credentials?.length) {
            for (const cred of credentialsResponse.credentials) {
                if (cred.rpId === rpId) {
                    return passkeyEntry.entry;
                }
            }
        }
    }
    
    return null;
}

async function findOrCreateEntryForRpId(rpId, rpName) {
    // Check if entry already exists
    const existingEntry = await findEntryForRpId(rpId);
    if (existingEntry) {
        return existingEntry;
    }
    
    // Prompt user for entry name
    // In a real implementation, this would show a proper UI
    // For now, we'll create a simple entry name based on rpId
    
    const entryName = rpName || rpId.replace(/\./g, '_');
    return entryName;
}

// MARK: - Direct PassKey Support (from content script)

async function handleDirectPasskeyCreate(request) {
    try {
        const { entry, rpId, userId, userName } = request;
        
        console.log('[pass-safari background] Direct PassKey creation:', { entry, rpId, userId, userName });
        
        if (!entry || !rpId || !userId || !userName) {
            return {
                ok: false,
                error: 'Missing required parameters'
            };
        }
        
        // Send to native app
        const response = await sendNativeMessage({
            command: 'createPasskey',
            entry: entry,
            rpId: rpId,
            userId: userId,
            userName: userName
        });
        
        console.log('[pass-safari background] Native app response:', response);
        
        return response;
        
    } catch (error) {
        console.error('[pass-safari background] Error in handleDirectPasskeyCreate:', error);
        return {
            ok: false,
            error: error.message || 'Unknown error'
        };
    }
}

async function handleListPasskeys() {
    try {
        console.log('[pass-safari background] Listing passkeys');
        
        const response = await sendNativeMessage({
            command: 'listPasskeys'
        });
        
        console.log('[pass-safari background] List response:', response);
        
        return response;
        
    } catch (error) {
        console.error('[pass-safari background] Error in handleListPasskeys:', error);
        return {
            ok: false,
            error: error.message || 'Unknown error'
        };
    }
}

async function handleDirectPasskeyAuth(request) {
    try {
        const { entry, rpId, challenge } = request;
        
        console.log('[pass-safari background] Direct PassKey authentication:', { entry, rpId, challenge: challenge?.substring(0, 20) + '...' });
        
        if (!entry || !rpId || !challenge) {
            return {
                ok: false,
                error: 'Missing required parameters'
            };
        }
        
        // First, get the credentials for this entry
        const credsResponse = await sendNativeMessage({
            command: 'getPasskeyCredentials',
            entry: entry
        });
        
        console.log('[pass-safari background] Credentials response:', credsResponse);
        
        if (!credsResponse?.ok || !credsResponse.credentials?.length) {
            return {
                ok: false,
                error: 'No credentials found for this entry'
            };
        }
        
        // Use the first credential (in production, user would choose)
        const credential = credsResponse.credentials[0];
        const credentialId = credential.credentialId;
        
        console.log('[pass-safari background] Using credential:', credentialId);
        
        // Sign the challenge
        const signResponse = await sendNativeMessage({
            command: 'authenticatePasskey',
            entry: entry,
            credentialId: credentialId,
            challenge: challenge
        });
        
        console.log('[pass-safari background] Sign response:', signResponse);
        
        if (signResponse?.ok) {
            return {
                ok: true,
                credentialId: credentialId,
                signature: signResponse.signature,
                entry: entry
            };
        } else {
            return {
                ok: false,
                error: signResponse?.error || 'Authentication failed'
            };
        }
        
    } catch (error) {
        console.error('[pass-safari background] Error in handleDirectPasskeyAuth:', error);
        return {
            ok: false,
            error: error.message || 'Unknown error'
        };
    }
}
