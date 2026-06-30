const SHORTCUT_STORAGE_KEY = "AutofillShortcutConfig";
const OTP_AUTO_SUBMIT_STORAGE_KEY = "OTPAutofillAutoSubmitEnabled";
const DEFAULT_AUTOFILL_SHORTCUT = Object.freeze({
    key: "o",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
});
const DEFAULT_OTP_AUTO_SUBMIT_ENABLED = false;

const OTP_STRONG_HINT_PATTERN = /(^|\b)(otp|totp|2fa|mfa|one[\s_-]*time|two[\s_-]*(factor|step)|authenticator)(\b|$)/;
const OTP_MEDIUM_HINT_PATTERN = /(^|\b)((verification|login|auth|confirm(ation)?)\s*[-_ ]*code|token)(\b|$)/;
const PAYMENT_CODE_HINT_PATTERN = /(^|\b)(cvv|cvc|csc|card[\s_-]*(verification|security)|credit[\s_-]*card)(\b|$)/;
const SUBMIT_POSITIVE_HINT_PATTERN = /(^|\b)(verify|continue|submit|sign[\s_-]*in|log[\s_-]*in|next|confirm|done|ok)(\b|$)/;
const SUBMIT_NEGATIVE_HINT_PATTERN = /(^|\b)(resend|again|back|cancel|close|change|edit|skip|alternative|another|different|recovery|backup)(\b|$)/;

let currentAutofillShortcut = DEFAULT_AUTOFILL_SHORTCUT;
let otpAutoSubmitEnabled = DEFAULT_OTP_AUTO_SUBMIT_ENABLED;

void loadAutofillShortcut();
void loadOTPAutofillAutoSubmitSetting();
document.addEventListener("keydown", onShortcutKeyDown, true);
globalThis.browser?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
        return;
    }

    if (changes[SHORTCUT_STORAGE_KEY]) {
        currentAutofillShortcut = normalizeShortcutConfig(changes[SHORTCUT_STORAGE_KEY].newValue);
    }

    if (changes[OTP_AUTO_SUBMIT_STORAGE_KEY]) {
        otpAutoSubmitEnabled = normalizeBooleanSetting(changes[OTP_AUTO_SUBMIT_STORAGE_KEY].newValue, DEFAULT_OTP_AUTO_SUBMIT_ENABLED);
    }
});

async function loadAutofillShortcut() {
    try {
        const storedValues = await globalThis.browser?.storage?.local?.get?.(SHORTCUT_STORAGE_KEY);
        currentAutofillShortcut = normalizeShortcutConfig(storedValues?.[SHORTCUT_STORAGE_KEY]);
    } catch (error) {
        console.warn("Unable to load autofill shortcut configuration.", error);
        currentAutofillShortcut = DEFAULT_AUTOFILL_SHORTCUT;
    }
}

async function loadOTPAutofillAutoSubmitSetting() {
    try {
        const storedValues = await globalThis.browser?.storage?.local?.get?.(OTP_AUTO_SUBMIT_STORAGE_KEY);
        otpAutoSubmitEnabled = normalizeBooleanSetting(storedValues?.[OTP_AUTO_SUBMIT_STORAGE_KEY], DEFAULT_OTP_AUTO_SUBMIT_ENABLED);
    } catch (error) {
        console.warn("Unable to load OTP auto-submit setting.", error);
        otpAutoSubmitEnabled = DEFAULT_OTP_AUTO_SUBMIT_ENABLED;
    }
}

function normalizeBooleanSetting(rawValue, defaultValue = false) {
    return typeof rawValue === "boolean" ? rawValue : defaultValue;
}

function normalizeShortcutConfig(rawConfig) {
    return {
        key: typeof rawConfig?.key === "string" && rawConfig.key.length === 1 ? rawConfig.key.toLowerCase() : DEFAULT_AUTOFILL_SHORTCUT.key,
        metaKey: Boolean(rawConfig?.metaKey ?? DEFAULT_AUTOFILL_SHORTCUT.metaKey),
        ctrlKey: Boolean(rawConfig?.ctrlKey ?? DEFAULT_AUTOFILL_SHORTCUT.ctrlKey),
        altKey: Boolean(rawConfig?.altKey ?? DEFAULT_AUTOFILL_SHORTCUT.altKey),
        shiftKey: Boolean(rawConfig?.shiftKey ?? DEFAULT_AUTOFILL_SHORTCUT.shiftKey),
    };
}

function matchesShortcut(event, shortcut) {
    if (!shortcut || event.repeat) {
        return false;
    }

    return event.key.toLowerCase() === shortcut.key
        && event.metaKey === shortcut.metaKey
        && event.ctrlKey === shortcut.ctrlKey
        && event.altKey === shortcut.altKey
        && event.shiftKey === shortcut.shiftKey;
}

function onShortcutKeyDown(event) {
    if (!matchesShortcut(event, currentAutofillShortcut)) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    void browser.runtime.sendMessage({
        command: "triggerShortcutAutofill",
    }).catch((error) => {
        console.warn("Unable to trigger shortcut autofill.", error);
    });
}

function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
        return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
        return false;
    }

    return element.getClientRects().length > 0;
}

function isFillableField(element) {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        return false;
    }

    if (element.disabled || element.readOnly) {
        return false;
    }

    return isVisibleElement(element);
}

function normalizeMetadataText(parts) {
    return parts
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function fieldMetadataText(element) {
    const labelText = element instanceof HTMLInputElement && element.labels
        ? [...element.labels].map((label) => label.textContent || "")
        : [];

    return normalizeMetadataText([
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute("aria-label"),
        element.autocomplete,
        element.getAttribute("inputmode"),
        element.getAttribute("pattern"),
        element.className,
        labelText,
    ]);
}

function containerMetadataText(container) {
    if (!(container instanceof HTMLElement)) {
        return "";
    }

    const labelText = [...container.querySelectorAll("label, legend")]
        .slice(0, 4)
        .map((element) => element.textContent || "");

    return normalizeMetadataText([
        container.id,
        container.className,
        container.getAttribute("aria-label"),
        container.getAttribute("role"),
        labelText,
    ]);
}

function hasStrongOTPHint(metadata) {
    return OTP_STRONG_HINT_PATTERN.test(metadata);
}

function hasMediumOTPHint(metadata) {
    return OTP_MEDIUM_HINT_PATTERN.test(metadata);
}

function hasPaymentCodeHint(metadata) {
    return PAYMENT_CODE_HINT_PATTERN.test(metadata);
}

function isSupportedOTPInputType(element) {
    if (!(element instanceof HTMLInputElement)) {
        return false;
    }

    return new Set(["", "text", "tel", "number", "password"]).has((element.type || "").toLowerCase());
}

function isNumericishOTPField(element) {
    if (!(element instanceof HTMLInputElement)) {
        return false;
    }

    return ["numeric", "decimal"].includes((element.inputMode || "").toLowerCase())
        || ["tel", "number"].includes((element.type || "").toLowerCase());
}

function isSegmentedOTPInputCandidate(element) {
    if (!(element instanceof HTMLInputElement) || !isFillableField(element) || !isSupportedOTPInputType(element)) {
        return false;
    }

    const maxLength = Number(element.maxLength);
    const size = Number(element.size);
    if (maxLength !== 1 && size !== 1) {
        return false;
    }

    const autocomplete = (element.autocomplete || "").toLowerCase();
    const metadata = fieldMetadataText(element);
    if (autocomplete === "cc-csc" || hasPaymentCodeHint(metadata)) {
        return false;
    }

    return true;
}

function otpFieldScore(element) {
    if (!(element instanceof HTMLInputElement) || !isFillableField(element) || !isSupportedOTPInputType(element) || isSegmentedOTPInputCandidate(element)) {
        return Number.NEGATIVE_INFINITY;
    }

    const autocomplete = (element.autocomplete || "").toLowerCase();
    const metadata = fieldMetadataText(element);
    if (autocomplete === "cc-csc" || hasPaymentCodeHint(metadata)) {
        return Number.NEGATIVE_INFINITY;
    }

    let score = 0;

    if (document.activeElement === element) {
        score += 120;
    }

    if (autocomplete === "one-time-code") {
        score += 240;
    }

    if (hasStrongOTPHint(metadata)) {
        score += 160;
    } else if (hasMediumOTPHint(metadata)) {
        score += 90;
    }

    if (isNumericishOTPField(element)) {
        score += 30;
    }

    if (Number.isInteger(element.maxLength) && element.maxLength >= 4 && element.maxLength <= 8) {
        score += 45;
    }

    if (/\d/.test(element.pattern || "")) {
        score += 20;
    }

    return score;
}

function isOTPFieldCandidate(element) {
    return otpFieldScore(element) >= 90;
}

function isPasswordField(element) {
    return element instanceof HTMLInputElement
        && element.type === "password"
        && isFillableField(element)
        && !isOTPFieldCandidate(element);
}

function isUsernameFieldCandidate(element) {
    if (!isFillableField(element)) {
        return false;
    }

    if (element instanceof HTMLTextAreaElement) {
        return false;
    }

    const supportedTypes = new Set(["", "text", "email", "tel", "url", "search"]);
    if (!supportedTypes.has(element.type)) {
        return false;
    }

    const autocomplete = (element.autocomplete || "").toLowerCase();
    if (["current-password", "new-password", "one-time-code"].includes(autocomplete)) {
        return false;
    }

    return !isOTPFieldCandidate(element) && !isSegmentedOTPInputCandidate(element);
}

function getPasswordFields(root = document) {
    return [...root.querySelectorAll('input[type="password"]')].filter(isPasswordField);
}

function getOTPFields(root = document) {
    return [...root.querySelectorAll("input")]
        .filter(isOTPFieldCandidate)
        .sort((left, right) => otpFieldScore(right) - otpFieldScore(left));
}

function usernameFieldScore(element, passwordField) {
    let score = 0;
    const autocomplete = (element.autocomplete || "").toLowerCase();
    const metadata = [
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute("aria-label"),
        autocomplete,
    ].join(" ").toLowerCase();

    if (document.activeElement === element) {
        score += 120;
    }

    if (autocomplete === "username") {
        score += 100;
    }

    if (element.type === "email") {
        score += 40;
    }

    if (/(^|\b)(user(name)?|login|email|e-mail|identifier)(\b|$)/.test(metadata)) {
        score += 80;
    }

    if (passwordField instanceof HTMLElement) {
        if (element.form && passwordField.form && element.form === passwordField.form) {
            score += 40;
        }

        if (element.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING) {
            score += 20;
        }
    }

    return score;
}

function getUsernameFields(root = document, passwordField = null) {
    return [...root.querySelectorAll("input, textarea")]
        .filter((element) => element !== passwordField)
        .filter(isUsernameFieldCandidate)
        .sort((left, right) => usernameFieldScore(right, passwordField) - usernameFieldScore(left, passwordField));
}

function otpClusterScore(fields, container) {
    if (!Array.isArray(fields) || fields.length < 4 || fields.length > 8) {
        return Number.NEGATIVE_INFINITY;
    }

    const metadata = normalizeMetadataText([
        containerMetadataText(container),
        fields.map((field) => fieldMetadataText(field)),
    ]);

    let score = 0;

    if (fields.includes(document.activeElement)) {
        score += 120;
    }

    if (fields.some((field) => (field.autocomplete || "").toLowerCase() === "one-time-code")) {
        score += 220;
    }

    if (hasStrongOTPHint(metadata)) {
        score += 150;
    } else if (hasMediumOTPHint(metadata)) {
        score += 90;
    }

    if (fields.every((field) => Number(field.maxLength) === 1 || Number(field.size) === 1)) {
        score += 30;
    }

    if (fields.every(isNumericishOTPField)) {
        score += 25;
    }

    return score;
}

function findSegmentedOTPClusterForField(field) {
    if (!isSegmentedOTPInputCandidate(field)) {
        return null;
    }

    let bestCluster = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let container = field.parentElement;

    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const fields = [...container.querySelectorAll("input")].filter(isSegmentedOTPInputCandidate);
        if (!fields.includes(field)) {
            continue;
        }

        const score = otpClusterScore(fields, container);
        if (score > bestScore) {
            bestScore = score;
            bestCluster = fields;
        }
    }

    return bestScore >= 170 ? bestCluster : null;
}

function findOTPFieldCluster(root = document) {
    if (document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement)) {
        const activeCluster = findSegmentedOTPClusterForField(document.activeElement);
        if (activeCluster) {
            return activeCluster;
        }
    }

    let bestCluster = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of [...root.querySelectorAll("input")].filter(isSegmentedOTPInputCandidate)) {
        const cluster = findSegmentedOTPClusterForField(candidate);
        if (!cluster) {
            continue;
        }

        const score = otpClusterScore(cluster, candidate.parentElement);
        if (score > bestScore) {
            bestScore = score;
            bestCluster = cluster;
        }
    }

    return bestCluster;
}

function findPasswordField() {
    if (isPasswordField(document.activeElement)) {
        return document.activeElement;
    }

    return getPasswordFields()[0] || null;
}

function findUsernameField(passwordField) {
    if (isUsernameFieldCandidate(document.activeElement) && document.activeElement !== passwordField) {
        return document.activeElement;
    }

    const preferredRoot = passwordField?.form || document;
    const preferredField = getUsernameFields(preferredRoot, passwordField)[0];
    if (preferredField) {
        return preferredField;
    }

    return getUsernameFields(document, passwordField)[0] || null;
}

function findOTPFillTarget(root = document) {
    if (document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement)) {
        const activeCluster = findSegmentedOTPClusterForField(document.activeElement);
        if (activeCluster) {
            return { type: "segmented", fields: activeCluster };
        }

        if (isOTPFieldCandidate(document.activeElement)) {
            return { type: "single", field: document.activeElement };
        }
    }

    const singleField = getOTPFields(root)[0];
    if (singleField) {
        return { type: "single", field: singleField };
    }

    const cluster = findOTPFieldCluster(root);
    if (cluster) {
        return { type: "segmented", fields: cluster };
    }

    return null;
}

function setFieldValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
        descriptor.set.call(element, value);
    } else {
        element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillOTPIntoTarget(target, otp) {
    if (!target || !otp) {
        return null;
    }

    if (target.type === "single") {
        setFieldValue(target.field, otp);
        return target.field;
    }

    const normalizedOTP = otp.replace(/\s+/g, "");
    if (normalizedOTP.length !== target.fields.length) {
        return null;
    }

    target.fields.forEach((field, index) => {
        setFieldValue(field, normalizedOTP[index] || "");
    });

    return target.fields[target.fields.length - 1] || null;
}

function formForOTPFillTarget(target) {
    if (!target) {
        return null;
    }

    if (target.type === "single") {
        return target.field?.form || null;
    }

    const firstFieldForm = target.fields[0]?.form || null;
    if (!firstFieldForm) {
        return null;
    }

    return target.fields.every((field) => field.form === firstFieldForm) ? firstFieldForm : null;
}

function metadataTextForControl(control) {
    return normalizeMetadataText([
        control.textContent,
        control.value,
        control.name,
        control.id,
        control.className,
        control.getAttribute("aria-label"),
        control.title,
    ]);
}

function isVisibleSubmitControl(element) {
    if (!(element instanceof HTMLButtonElement) && !(element instanceof HTMLInputElement)) {
        return false;
    }

    if (element.disabled || !isVisibleElement(element)) {
        return false;
    }

    const type = (element.getAttribute("type") || element.type || "").toLowerCase();
    if (element instanceof HTMLButtonElement) {
        return type === "" || type === "submit";
    }

    return ["submit", "image"].includes(type);
}

function submitControlScore(control) {
    const metadata = metadataTextForControl(control);
    if (SUBMIT_NEGATIVE_HINT_PATTERN.test(metadata)) {
        return Number.NEGATIVE_INFINITY;
    }

    let score = 1;
    if (SUBMIT_POSITIVE_HINT_PATTERN.test(metadata)) {
        score += 20;
    }
    if (document.activeElement === control) {
        score += 5;
    }

    return score;
}

function preferredSubmitControl(form) {
    const candidates = [...form.querySelectorAll("button, input")]
        .filter(isVisibleSubmitControl)
        .map((control) => ({
            control,
            score: submitControlScore(control),
        }))
        .filter((candidate) => Number.isFinite(candidate.score))
        .sort((left, right) => right.score - left.score);

    if (candidates.length === 0) {
        return null;
    }

    if (candidates.length === 1) {
        return candidates[0].control;
    }

    const positiveCandidates = candidates.filter((candidate) => candidate.score > 1);
    return positiveCandidates.length === 1 ? positiveCandidates[0].control : null;
}

function isBlockingVisibleTextField(element, ignoredElements) {
    if (ignoredElements.has(element) || !isFillableField(element) || isOTPFieldCandidate(element) || isSegmentedOTPInputCandidate(element)) {
        return false;
    }

    if (element instanceof HTMLTextAreaElement) {
        return element.value.trim().length === 0;
    }

    const type = (element.type || "").toLowerCase();
    if (!["", "text", "email", "tel", "url", "search", "number", "password"].includes(type)) {
        return false;
    }

    return element.value.trim().length === 0;
}

function hasBlockingVisibleFields(form, ignoredElements) {
    return [...form.querySelectorAll("input, textarea")].some((element) => isBlockingVisibleTextField(element, ignoredElements));
}

function autoSubmitOTPFormIfAppropriate({ otpTarget, filledUsername, filledPassword, filledOTP }) {
    if (!otpAutoSubmitEnabled || !filledOTP || filledUsername || filledPassword || !otpTarget) {
        return false;
    }

    const form = formForOTPFillTarget(otpTarget);
    if (!(form instanceof HTMLFormElement)) {
        return false;
    }

    const ignoredElements = new Set(otpTarget.type === "single" ? [otpTarget.field] : otpTarget.fields);
    if (hasBlockingVisibleFields(form, ignoredElements)) {
        return false;
    }

    const submitControl = preferredSubmitControl(form);
    if (submitControl) {
        if (typeof form.requestSubmit === "function") {
            form.requestSubmit(submitControl);
        } else {
            submitControl.click();
        }
        return true;
    }

    if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return true;
    }

    return false;
}

function formatFieldList(fields) {
    if (fields.length === 0) {
        return "";
    }

    if (fields.length === 1) {
        return fields[0];
    }

    if (fields.length === 2) {
        return `${fields[0]} and ${fields[1]}`;
    }

    return `${fields.slice(0, -1).join(", ")}, and ${fields.at(-1)}`;
}

function requestedFieldNames({ username, password, otp }) {
    const fields = [];
    if (username) {
        fields.push("username");
    }
    if (password) {
        fields.push("password");
    }
    if (otp) {
        fields.push("one-time code");
    }
    return fields;
}

function successMessage({ username, password, otp, filledUsername, filledPassword, filledOTP, autoSubmittedOTPForm }) {
    const filledFields = [];
    if (filledUsername) {
        filledFields.push("username");
    }
    if (filledPassword) {
        filledFields.push("password");
    }
    if (filledOTP) {
        filledFields.push("one-time code");
    }

    const missingFields = [];
    if (username && !filledUsername) {
        missingFields.push("username");
    }
    if (password && !filledPassword) {
        missingFields.push("password");
    }
    if (otp && !filledOTP) {
        missingFields.push("one-time code");
    }

    let message = `Filled ${formatFieldList(filledFields)}.`;
    if (missingFields.length > 0) {
        const missingFieldsLabel = formatFieldList(missingFields);
        message += ` No compatible ${missingFieldsLabel} field${missingFields.length === 1 ? " was" : "s were"} found on this page.`;
    }

    if (autoSubmittedOTPForm) {
        message += " Submitted the verification form.";
    }

    return message;
}

function autofillEntry(request) {
    const username = typeof request?.username === "string" ? request.username : "";
    const password = typeof request?.password === "string" ? request.password : "";
    const otp = typeof request?.otp === "string" ? request.otp : "";

    const passwordField = password ? findPasswordField() : null;
    const usernameField = username ? findUsernameField(passwordField) : null;
    const otpTarget = otp
        ? findOTPFillTarget(passwordField?.form || document) || findOTPFillTarget(document)
        : null;

    let filledUsername = false;
    let filledPassword = false;
    let filledOTP = false;
    let focusTarget = null;

    if (username && usernameField) {
        setFieldValue(usernameField, username);
        filledUsername = true;
        focusTarget = usernameField;
    }

    if (password && passwordField) {
        setFieldValue(passwordField, password);
        filledPassword = true;
        focusTarget = passwordField;
    }

    if (otp && otpTarget) {
        const otpFocusTarget = fillOTPIntoTarget(otpTarget, otp);
        if (otpFocusTarget) {
            filledOTP = true;
            focusTarget = otpFocusTarget;
        }
    }

    if (!filledUsername && !filledPassword && !filledOTP) {
        const requestedFields = requestedFieldNames({ username, password, otp });
        return {
            ok: false,
            error: requestedFields.length > 0
                ? `No compatible ${formatFieldList(requestedFields)} field${requestedFields.length === 1 ? " was" : "s were"} found on this page.`
                : "Nothing to autofill.",
        };
    }

    focusTarget?.focus({ preventScroll: false });

    const autoSubmittedOTPForm = autoSubmitOTPFormIfAppropriate({
        otpTarget,
        filledUsername,
        filledPassword,
        filledOTP,
    });

    return {
        ok: true,
        filledUsername,
        filledPassword,
        filledOTP,
        autoSubmittedOTPForm,
        message: successMessage({ username, password, otp, filledUsername, filledPassword, filledOTP, autoSubmittedOTPForm }),
    };
}

browser.runtime.onMessage.addListener((request) => {
    if (request?.command !== "autofillEntry") {
        return undefined;
    }

    try {
        return Promise.resolve(autofillEntry(request));
    } catch (error) {
        return Promise.resolve({
            ok: false,
            error: error instanceof Error ? error.message : "Autofill failed.",
        });
    }
});

// Listen for direct PassKey creation requests from web page
document.addEventListener('pass-safari-create-passkey', async (event) => {
    console.log('[pass-safari content] Received direct passkey creation request', event.detail);
    
    try {
        const result = await browser.runtime.sendMessage({
            command: 'createPasskey',
            entry: event.detail.entry,
            rpId: event.detail.rpId,
            userId: event.detail.userId,
            userName: event.detail.userName
        });
        
        console.log('[pass-safari content] PassKey creation result:', result);
        
        // Send response back to web page
        window.dispatchEvent(new CustomEvent('pass-safari-passkey-response', {
            detail: result
        }));
    } catch (error) {
        console.error('[pass-safari content] Error creating passkey:', error);
        
        window.dispatchEvent(new CustomEvent('pass-safari-passkey-response', {
            detail: {
                ok: false,
                error: error.message
            }
        }));
    }
});

// Listen for direct PassKey authentication requests from web page
document.addEventListener('pass-safari-auth-passkey', async (event) => {
    console.log('[pass-safari content] Received direct passkey authentication request', event.detail);
    
    try {
        const result = await browser.runtime.sendMessage({
            command: 'authenticatePasskey',
            entry: event.detail.entry,
            rpId: event.detail.rpId,
            challenge: event.detail.challenge
        });
        
        console.log('[pass-safari content] PassKey authentication result:', result);
        
        // Send response back to web page
        window.dispatchEvent(new CustomEvent('pass-safari-auth-response', {
            detail: result
        }));
    } catch (error) {
        console.error('[pass-safari content] Error authenticating passkey:', error);
        
        window.dispatchEvent(new CustomEvent('pass-safari-auth-response', {
            detail: {
                ok: false,
                error: error.message
            }
        }));
    }
});
