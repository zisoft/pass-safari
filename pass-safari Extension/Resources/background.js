const NATIVE_APP_IDS = [
    "de.zisoft.pass-safari",
    "de.zisoft.pass-safari.Extension",
];

browser.runtime.onMessage.addListener((request, sender) => {
    if (request?.command === "triggerShortcutAutofill") {
        return autofillBestMatchForTab(sender.tab);
    }

    return undefined;
});

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
