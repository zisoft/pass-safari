const NATIVE_APP_IDS = [
  "de.zisoft.pass-safari",
  "de.zisoft.pass-safari.Extension",
];
const DEFAULT_STORE_PATH = "~/.password-store";
const SHORTCUT_STORAGE_KEY = "AutofillShortcutConfig";
const OTP_AUTO_SUBMIT_STORAGE_KEY = "OTPAutofillAutoSubmitEnabled";
const DEFAULT_AUTOFILL_SHORTCUT = Object.freeze({
  key: "l",
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: true,
});

const searchInput = document.getElementById("search");
const statusElement = document.getElementById("status");
const suggestionsArea = document.getElementById("suggestions-area");
const suggestionsElement = document.getElementById("suggestions");
const entriesElement = document.getElementById("entries");
const storePathElement = document.getElementById("store-path");
const storeModeElement = document.getElementById("store-mode");
const chooseStoreButton = document.getElementById("choose-store");
const useDefaultButton = document.getElementById("use-default");
const toggleSetupButton = document.getElementById("toggle-setup");
const setupPanelElement = document.getElementById("setup-panel");
const otpAutoSubmitCheckboxElement = document.getElementById("otp-auto-submit");
const shortcutDisplayElement = document.getElementById("shortcut-display");
const shortcutHintElement = document.getElementById("shortcut-hint");
const recordShortcutButton = document.getElementById("record-shortcut");
const resetShortcutButton = document.getElementById("reset-shortcut");
const detailsTitleElement = document.getElementById("details-title");
const detailsStatusElement = document.getElementById("details-status");
const detailPasswordRowElement = document.getElementById("detail-password-row");
const detailPasswordElement = document.getElementById("detail-password");
const detailUsernameRowElement = document.getElementById("detail-username-row");
const detailUsernameElement = document.getElementById("detail-username");
const detailOTPRowElement = document.getElementById("detail-otp-row");
const detailOTPLabelElement = document.getElementById("detail-otp-label");
const detailOTPElement = document.getElementById("detail-otp");
const detailURLRowElement = document.getElementById("detail-url-row");
const detailURLElement = document.getElementById("detail-url");
const detailAdditionalFields = document.getElementById("detail-additional-fields");
const detailNotesRowElement = document.getElementById("detail-notes-row");
const detailNotesElement = document.getElementById("detail-notes");
const copyPasswordButton = document.getElementById("copy-password");
const copyUsernameButton = document.getElementById("copy-username");
const copyOTPButton = document.getElementById("copy-otp");
const openURLButton = document.getElementById("open-url");
const togglePasswordButton = document.getElementById("toggle-password");
const autofillEntryButton = document.getElementById("autofill-entry");
const closeDetailsButton = document.getElementById("close-details");
const editEntryButton = document.getElementById("edit-entry");
const mainPanelElement = document.getElementById("main-panel");
const editPanelElement = document.getElementById("edit-panel");
const detailPanelElement = document.getElementById("detail-panel");
const editTitleElement = document.getElementById("edit-title");
const editTitleInput = document.getElementById("edit-title-input");
const editPasswordInput = document.getElementById("edit-password-input");
const editTogglePasswordButton = document.getElementById("edit-toggle-password");
const editUsernameInput = document.getElementById("edit-username-input");
const editURLInput = document.getElementById("edit-url-input");
const editStatusElement = document.getElementById("edit-status");
const editContentTextarea = document.getElementById("edit-content");
const deleteEditButton = document.getElementById("delete-edit");
const cancelEditButton = document.getElementById("cancel-edit");
const saveEditButton = document.getElementById("save-edit");
const entriesHeaderTitle = document.getElementById("entries-header-title");
const entriesCounter = document.getElementById("entries-counter");
const suggestionsCounter = document.getElementById("suggestions-counter");
const newEntryButton = document.getElementById("new-entry");

const buttonFeedbackResetHandles = new WeakMap();

let allEntries = [];
let allSuggestions = [];
let currentStorePath = DEFAULT_STORE_PATH;
let currentTabURL = "";
let usingDefaultStore = true;
let selectedEntry = null;
let selectedEntryDetails = null;
let isPasswordVisible = false;
let isRecordingShortcut = false;
let otpRefreshIntervalHandle = null;
let otpRefreshInFlight = false;
let otpRefreshLastBucket = null;
let urlIndexStatusPollTimeoutHandle = null;
let newEntry = false;

init().catch((error) => {
  console.error(error);
  setStatus(error.message || "Failed to initialize extension.", true);
});

async function init() {
  searchInput.addEventListener("input", renderEntries);
  searchInput.addEventListener("keydown", onSearchKeyDown);
  entriesElement.addEventListener("keydown", onEntriesKeyDown);
  chooseStoreButton.addEventListener("click", onChooseStoreClick);
  useDefaultButton.addEventListener("click", onUseDefaultClick);
  // toggleSetupButton.addEventListener("click", onToggleSetupClick);
  recordShortcutButton.addEventListener("click", onRecordShortcutClick);
  resetShortcutButton.addEventListener("click", onResetShortcutClick);
  otpAutoSubmitCheckboxElement.addEventListener("change", onOTPSubmitSettingChange);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeyDown);
  copyPasswordButton.addEventListener("click", () => onCopyFieldClick("password"));
  copyUsernameButton.addEventListener("click", () => onCopyFieldClick("username"));
  copyOTPButton.addEventListener("click", () => onCopyFieldClick("otp"));
  openURLButton.addEventListener("click", () => onOpenURLClick());
  togglePasswordButton.addEventListener("click", onTogglePasswordClick);
  autofillEntryButton.addEventListener("click", onAutofillEntryClick);
  closeDetailsButton.addEventListener("click", onCloseDetailsClicked);
  editEntryButton.addEventListener("click", openEditPanel);
  deleteEditButton.addEventListener("click", onDeleteEntryClicked);
  cancelEditButton.addEventListener("click", onCloseEditClick);
  saveEditButton.addEventListener("click", onSaveEditClick);
  newEntryButton.addEventListener("click", onNewEntryClick);
  editTogglePasswordButton.addEventListener("click", onEditTogglePasswordClick);

  try {
    await refreshActiveTabContext();
  } catch (error) {
    console.warn("Unable to inspect the active tab.", error);
  }

  await refreshSetupSettingsUI();

  await refreshStoreConfiguration();
  await loadEntries();

  requestAnimationFrame(() => {
    focusSearchInput();
  });
}

function setSetupPanelOpen(isOpen) {
  setupPanelElement.hidden = !isOpen;
  toggleSetupButton.setAttribute("aria-expanded", String(isOpen));
  toggleSetupButton.setAttribute("aria-label", isOpen ? "Hide setup" : "Show setup");
  toggleSetupButton.title = isOpen ? "Hide setup" : "Setup";

  if (!isOpen && isRecordingShortcut) {
    isRecordingShortcut = false;
    void refreshSetupSettingsUI();
  }
}

function onToggleSetupClick(event) {
  event.stopPropagation();
  const willOpen = setupPanelElement.hidden;
  setSetupPanelOpen(willOpen);
  if (willOpen) {
    void refreshSetupSettingsUI();
  }
}

function onDocumentClick(event) {
  if (setupPanelElement.hidden) {
    return;
  }

  const clickedInsideSetup = setupPanelElement.contains(event.target);
  const clickedToggle = toggleSetupButton.contains(event.target);
  if (!clickedInsideSetup && !clickedToggle) {
    setSetupPanelOpen(false);
  }
}

function onDocumentKeyDown(event) {
  if (isRecordingShortcut) {
    void onShortcutRecordingKeyDown(event);
    return;
  }

  if (event.key === "Escape" && !setupPanelElement.hidden) {
    setSetupPanelOpen(false);
    toggleSetupButton.focus();
  }
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

async function readShortcutConfig() {
  const storedValues = await globalThis.browser?.storage?.local?.get?.(SHORTCUT_STORAGE_KEY);
  return normalizeShortcutConfig(storedValues?.[SHORTCUT_STORAGE_KEY]);
}

async function writeShortcutConfig(shortcutConfig) {
  const normalizedShortcutConfig = normalizeShortcutConfig(shortcutConfig);
  await globalThis.browser?.storage?.local?.set?.({
    [SHORTCUT_STORAGE_KEY]: normalizedShortcutConfig,
  });
  return normalizedShortcutConfig;
}

async function readOTPAutofillAutoSubmitEnabled() {
  const storedValues = await globalThis.browser?.storage?.local?.get?.(OTP_AUTO_SUBMIT_STORAGE_KEY);
  return Boolean(storedValues?.[OTP_AUTO_SUBMIT_STORAGE_KEY]);
}

async function writeOTPAutofillAutoSubmitEnabled(isEnabled) {
  await globalThis.browser?.storage?.local?.set?.({
    [OTP_AUTO_SUBMIT_STORAGE_KEY]: Boolean(isEnabled),
  });
}

function shortcutConfigDisplay(shortcutConfig) {
  const parts = [];
  if (shortcutConfig.metaKey) {
    parts.push("⌘");
  }
  if (shortcutConfig.ctrlKey) {
    parts.push("⌃");
  }
  if (shortcutConfig.altKey) {
    parts.push("⌥");
  }
  if (shortcutConfig.shiftKey) {
    parts.push("⇧");
  }
  parts.push(shortcutConfig.key.toUpperCase());
  return parts.join("");
}

function beginShortcutRecording() {
  isRecordingShortcut = true;
  shortcutDisplayElement.textContent = "Press keys…";
  shortcutHintElement.textContent = "Press a key combination with at least one modifier. Esc cancels.";
  recordShortcutButton.textContent = "Recording…";
}

async function refreshShortcutSettingsUI() {
  const shortcutConfig = await readShortcutConfig();
  shortcutDisplayElement.textContent = shortcutConfigDisplay(shortcutConfig);
  shortcutHintElement.textContent = "Works when a webpage has focus. If no exact match exists, the popup opens for manual selection.";
  recordShortcutButton.textContent = "Change…";
}

async function refreshOTPAutofillSettingsUI() {
  otpAutoSubmitCheckboxElement.checked = await readOTPAutofillAutoSubmitEnabled();
}

async function refreshSetupSettingsUI() {
  await Promise.all([
    refreshShortcutSettingsUI(),
    refreshOTPAutofillSettingsUI(),
  ]);
}

function onRecordShortcutClick() {
  beginShortcutRecording();
}

async function onResetShortcutClick() {
  isRecordingShortcut = false;
  await writeShortcutConfig(DEFAULT_AUTOFILL_SHORTCUT);
  await refreshSetupSettingsUI();
}

async function onOTPSubmitSettingChange() {
  await writeOTPAutofillAutoSubmitEnabled(otpAutoSubmitCheckboxElement.checked);
}

function isModifierOnlyKey(key) {
  return ["Meta", "Control", "Alt", "Shift"].includes(key);
}

async function onShortcutRecordingKeyDown(event) {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    isRecordingShortcut = false;
    await refreshSetupSettingsUI();
    return;
  }

  if (isModifierOnlyKey(event.key)) {
    return;
  }

  const shortcutConfig = {
    key: event.key.toLowerCase(),
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };

  if (!shortcutConfig.metaKey && !shortcutConfig.ctrlKey && !shortcutConfig.altKey && !shortcutConfig.shiftKey) {
    shortcutHintElement.textContent = "Add at least one modifier key like ⌘, ⌃, ⌥, or ⇧.";
    return;
  }

  isRecordingShortcut = false;
  await writeShortcutConfig(shortcutConfig);
  await refreshSetupSettingsUI();
}

async function onChooseStoreClick() {
  setSetupPanelOpen(false);
  setBusy(true);
  setStatus("Open the companion app and choose a password-store folder…");

  try {
    const response = await sendNativeMessage({
      command: "chooseStoreFolder",
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to choose a password store folder.");
    }

    if (response.cancelled) {
      setStatus("Folder selection cancelled.");
      return;
    }

    clearSelectedEntry();
    await loadEntries();
  } catch (error) {
    setStatus(error.message || "Unable to choose a password store folder.", true);
  } finally {
    setBusy(false);
  }
}

async function onUseDefaultClick() {
  setSetupPanelOpen(false);
  setBusy(true);
  setStatus("Switching to the default password store…");

  try {
    const response = await sendNativeMessage({
      command: "resetStoreFolder",
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to switch to the default password store.");
    }

    clearSelectedEntry();
    await loadEntries();
  } catch (error) {
    setStatus(error.message || "Unable to switch to the default password store.", true);
  } finally {
    setBusy(false);
  }
}

async function onEntryClick(entry, { preserveSearchFocus = false } = {}) {
  selectedEntry = entry;
  selectedEntryDetails = null;
  renderEntries();

  if (preserveSearchFocus) {
    requestAnimationFrame(() => {
      focusSearchInput();
    });
  }

  try {
    const response = await sendNativeMessage({
      command: "getEntryDetails",
      entry,
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (selectedEntry !== entry) {
      return;
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load entry details.");
    }

    selectedEntryDetails = response;
  } catch (error) {
    if (selectedEntry !== entry) {
      return;
    }
  }
}

async function copyText(value) {
  try {
    const response = await sendNativeMessage({
      command: "copyText",
      text: value,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to copy value.");
    }

  } catch (error) {
    setDetailStatus(error.message || "Unable to copy value.", true);
  }
}

async function onCopyFieldClick(fieldName) {
  if (!selectedEntryDetails) {
    return;
  }

  const value = selectedEntryDetails[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    return;
  }

  await copyText(value);
}

function onOpenURLClick() {
  if (!selectedEntryDetails) {
    return;
  }

  const url = selectedEntryDetails["url"];
  if (typeof url !== "string" || url.length === 0) {
    return;
  }

  window.location.href = url;
}

function onTogglePasswordClick() {
  const password = typeof selectedEntryDetails?.password === "string" ? selectedEntryDetails.password : "";
  if (!password) {
    return;
  }

  isPasswordVisible = !isPasswordVisible;
  updatePasswordVisibility();
}

function onEditTogglePasswordClick() {
  const type = editPasswordInput.getAttribute("type");
  if(type == "password") {
    editPasswordInput.setAttribute("type", "text");
    editTogglePasswordButton.innerHTML = editTogglePasswordButton.dataset.hide_icon;
    editTogglePasswordButton.title = "Hide password";
  }
  else {
    editPasswordInput.setAttribute("type", "password");
    editTogglePasswordButton.innerHTML = editTogglePasswordButton.dataset.show_icon;
    editTogglePasswordButton.title = "Show password";
  }
}

async function ensureFreshOTPBeforeAutofill() {
  if (!selectedEntryDetails?.otp || otpRefreshType() !== "totp") {
    return;
  }

  const currentBucket = currentOTPBucket();
  if (currentBucket === null || currentBucket === otpRefreshLastBucket) {
    return;
  }

  otpRefreshLastBucket = currentBucket;
  await refreshSelectedEntryOTP();
}

async function onAutofillEntryClick() {
  if (!selectedEntryDetails) {
    return;
  }

  const password = typeof selectedEntryDetails.password === "string" ? selectedEntryDetails.password : "";
  const username = typeof selectedEntryDetails.username === "string" ? selectedEntryDetails.username : "";
  const otp = typeof selectedEntryDetails.otp === "string" ? selectedEntryDetails.otp : "";

  if (!password && !username && !otp) {
    setDetailStatus("Nothing to autofill.", true);
    return;
  }

  autofillEntryButton.disabled = true;
  setDetailStatus("Autofilling the current page…");

  try {
    await ensureFreshOTPBeforeAutofill();
    await refreshActiveTabContext();
    updateAutofillButtonState();

    const response = await sendMessageToActiveTab({
      command: "autofillEntry",
      entry: selectedEntryDetails.entry || selectedEntry,
      password,
      username,
      otp: typeof selectedEntryDetails.otp === "string" ? selectedEntryDetails.otp : otp,
      url: selectedEntryDetails.url || "",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to autofill the current page.");
    }

    setDetailStatus(response.message || "Autofill completed.");

    // close popup after autofill
    window.close();

  } catch (error) {
    setDetailStatus(error.message || "Unable to autofill the current page.", true);
  } finally {
    updateAutofillButtonState();
  }
}

async function getEntryData(entry) {
  try {
    selectedEntry = null;
    selectedEntryDetails = null;

    const response = await sendNativeMessage({
      command: "getEntryDetails",
      entry,
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load entry details.");
    }

    selectedEntry = entry;
    selectedEntryDetails = response;

  } catch (error) {
    setDetailStatus(error.message || "Unable to load entry details.", true);
  }
}

async function onEditEntryClick() {
  const entry = this.dataset.entry;
  if(!entry)
    return;

  if (selectedEntry !== entry || !selectedEntryDetails) {
    await getEntryData(entry);
  }

  openEditPanel();
}

function openEditPanel() {
  mainPanelElement.hidden = true;
  detailPanelElement.hidden = true;
  editPanelElement.hidden = false;
  
  deleteEditButton.textContent = "Delete";
  deleteEditButton.dataset.confirmed = "";
  
  editPasswordInput.setAttribute("type", "password");
  editTogglePasswordButton.innerHTML = editTogglePasswordButton.dataset.show_icon;
  editTogglePasswordButton.title = "Show password";

  if(newEntry) {
    editTitleElement.hidden = true;
    editTitleInput.hidden = false;
    selectedEntry = null;
    selectedEntryDetails = null;
    editPasswordInput.value = "";
    editUsernameInput.value = "";
    editURLInput.value = "";
    editContentTextarea.value = "";
    editTitleInput.value = "";
    editTitleInput.focus();
  }
  else {
    editTitleElement.textContent = `${selectedEntry}`;
    editTitleElement.hidden = false;
    editTitleInput.hidden = true;
  }

  const password = typeof selectedEntryDetails.password === "string" ? selectedEntryDetails.password : "";
  editPasswordInput.value = password;

  const username = typeof selectedEntryDetails.username === "string" ? selectedEntryDetails.username : "";
  editUsernameInput.value = username;

  const url = typeof selectedEntryDetails.url === "string" ? selectedEntryDetails.url : "";
  editURLInput.value = url;

  // Add custom fields
  const lines = [];
  if (Array.isArray(selectedEntryDetails.fields)) {
    for (const field of selectedEntryDetails.fields) {
      if (field.label && field.value) {
        lines.push(`${field.label}: ${field.value}`);
      }
    }
  }

  // Add notes if present
  if (selectedEntryDetails.notes) {
    lines.push(selectedEntryDetails.notes);
  }

  editContentTextarea.value = lines.join("\n");

  setEditStatus("");

  if(!newEntry) {
    editContentTextarea.focus();
  }
}

async function onDeleteEntryClicked() {
  if(!selectedEntry)
    return;

  if(deleteEditButton.dataset.confirmed === "confirmed") {
    deleteEditButton.textContent = "Delete";
    deleteEditButton.dataset.confirmed = "";
    deleteEditButton.disabled = true;

    setEditStatus("Deleting entry...");

    try {
      const response = await sendNativeMessage({
        command: "deleteEntry",
        entry: selectedEntry,
      });

      if (response?.storePath) {
        applyStoreConfiguration(response);
      }

      if (!response?.ok) {
        throw new Error(response?.error || "Unable to delete entry.");
      }

      selectedEntry = null;
      selectedEntryDetails = null;

      setEditStatus("Entry deleted successfully.");

      // Close the edit panel and reload the entry details
      setTimeout(() => {
        closeEditPanel();
      }, 800);

    } catch (error) {
      setEditStatus(error.message || "Unable to delete entry.", true);
    }
    finally {
      deleteEditButton.disabled = false;
    } 
  }
  else {
    deleteEditButton.textContent = "Click again to delete!";
    deleteEditButton.dataset.confirmed = "confirmed";
  }

}

function onCloseEditClick() {
  closeEditPanel();
}

function closeEditPanel() {
  editPanelElement.hidden = true;
  detailPanelElement.hidden = true;
  editContentTextarea.value = "";
  setEditStatus("");
  if(newEntry)
    loadEntries();
  newEntry = false;
  mainPanelElement.hidden = false;
}

async function onSaveEditClick() {
  if (!selectedEntry && !newEntry) {
    return;
  }

  if(newEntry) {
    selectedEntry = editTitleInput.value;
    if(!selectedEntry) {
      setEditStatus("Title content cannot be empty.", true);
      editTitleInput.focus();
      return;
    }
  }

  const password = editPasswordInput.value;
  const username = editUsernameInput.value;
  const url = editURLInput.value;

  let content = `${password}\n`;
  if(username !== "")
    content += `username: ${username}\n`;
  if(url !== "")
    content += `url: ${url}\n`;

  content += `${editContentTextarea.value}`;

  if (!content.trim()) {
    setEditStatus("Entry content cannot be empty.", true);
    return;
  }

  saveEditButton.disabled = true;
  setEditStatus("Saving entry…");

  try {
    const response = await sendNativeMessage({
      command: "updateEntry",
      entry: selectedEntry,
      content: content,
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to save entry.");
    }

    setEditStatus("Entry saved successfully.");

    // Close the edit panel and reload the entry details
    setTimeout(() => {
      closeEditPanel();
    }, 800);
  } catch (error) {
    setEditStatus(error.message || "Unable to save entry.", true);
  } finally {
    saveEditButton.disabled = false;
  }
}

function setEditStatus(message, isError = false) {
  editStatusElement.textContent = message;
  editStatusElement.classList.toggle("error", isError);
  editStatusElement.hidden = !message;
}

async function refreshStoreConfiguration() {
  const response = await sendNativeMessage({
    command: "getStoreConfiguration",
  });

  if (response?.storePath) {
    applyStoreConfiguration(response);
  }

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to read the password store configuration.");
  }
}

function clearURLIndexStatusPoll() {
  if (urlIndexStatusPollTimeoutHandle !== null) {
    clearTimeout(urlIndexStatusPollTimeoutHandle);
    urlIndexStatusPollTimeoutHandle = null;
  }
}

function scheduleURLIndexStatusPoll(delay = 4000) {
  clearURLIndexStatusPoll();
  urlIndexStatusPollTimeoutHandle = setTimeout(() => {
    urlIndexStatusPollTimeoutHandle = null;
    void refreshURLIndexStatus();
  }, delay);
}

async function refreshURLIndexStatus() {
  try {
    const response = await sendNativeMessage({
      command: "listEntries",
      pageURL: currentTabURL,
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (!response?.ok) {
      return;
    }

    const refreshedEntries = Array.isArray(response.entries) ? response.entries : [];
    const entryListChanged = refreshedEntries.length !== allEntries.length
      || refreshedEntries.some((entry, index) => entry !== allEntries[index]);

    if (entryListChanged) {
      allEntries = refreshedEntries;
      if (selectedEntry && !allEntries.includes(selectedEntry)) {
        clearSelectedEntry();
      }
      renderEntries();
    }

    if (response?.urlIndexRefreshing) {
      scheduleURLIndexStatusPoll();
      return;
    }

    const indexedSuggestedEntry = Array.isArray(response.suggestedEntries) && response.suggestedEntries.length > 0
      ? response.suggestedEntries[0]
      : null;

    setStatus("");

  } catch {
    scheduleURLIndexStatusPoll(8000);
  }
}

async function loadEntries() {
  clearURLIndexStatusPoll();
  setStatus("Loading entries…");
  entriesElement.replaceChildren();

  try {
    const response = await sendNativeMessage({
      command: "listEntries",
      pageURL: currentTabURL,
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load pass entries.");
    }

    allEntries = Array.isArray(response.entries) ? response.entries : [];
    allSuggestions = Array.isArray(response.suggestedEntries) ? response.suggestedEntries : [];

    if (selectedEntry && !allEntries.includes(selectedEntry)) {
      clearSelectedEntry();
    }

    renderEntries();

    if (allEntries.length === 0) {
      setStatus(`No entries found in ${currentStorePath}.`);
      return;
    }

    const indexedSuggestedEntry = Array.isArray(response.suggestedEntries) && response.suggestedEntries.length > 0
      ? response.suggestedEntries[0]
      : null;
    const fallbackSuggestedEntry = bestMatchingEntryForCurrentTab(allEntries);
    const suggestedEntry = selectedEntry ? null : (indexedSuggestedEntry || fallbackSuggestedEntry);

    if (response?.urlIndexRefreshing) {
      setStatus(` Building the site index in the background…`);
      scheduleURLIndexStatusPoll();
    } else {
      setStatus("");
    }

  } catch (error) {
    allEntries = [];
    clearSelectedEntry();
    renderEntries();
    setStatus(error.message || "Unable to load pass entries.", true);
  }
}

function applyStoreConfiguration(response) {
  currentStorePath = response?.storePath || DEFAULT_STORE_PATH;
  usingDefaultStore = Boolean(response?.usingDefaultStore);

  storePathElement.textContent = currentStorePath;
  storePathElement.title = currentStorePath;
  storeModeElement.textContent = usingDefaultStore
    ? "Using the default password store folder."
    : "Using a user-selected password store folder.";
  useDefaultButton.disabled = usingDefaultStore;
}

function currentTabDisplayHost() {
  return currentTabMatchContext()?.hostname || "the current tab";
}

function isMeaningfulMatchToken(token) {
  return token.length >= 3 && !/^\d+$/.test(token);
}

function tokenizeText(value) {
  return (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
}

function currentTabMatchContext() {
  const activeURL = parsedURL(currentTabURL);
  if (!activeURL || !["http:", "https:"].includes(activeURL.protocol)) {
    return null;
  }

  const normalizedHostname = activeURL.hostname.toLowerCase().replace(/^www\./, "");
  const hostnameLabels = normalizedHostname.split(".").filter(Boolean);
  if (hostnameLabels.length === 0) {
    return null;
  }

  let baseDomain = normalizedHostname;
  if (hostnameLabels.length >= 3 && hostnameLabels.at(-2).length <= 3) {
    baseDomain = hostnameLabels.slice(-3).join(".");
  } else if (hostnameLabels.length >= 2) {
    baseDomain = hostnameLabels.slice(-2).join(".");
  }

  const variants = new Set([normalizedHostname, baseDomain]);
  if (hostnameLabels.length >= 2) {
    variants.add(hostnameLabels.slice(-2).join("."));
  }
  const hostnameTokens = [...new Set(tokenizeText(baseDomain).filter(isMeaningfulMatchToken))];
  const pathTokens = [...new Set(tokenizeText(activeURL.pathname).filter(isMeaningfulMatchToken))];

  return {
    hostname: normalizedHostname,
    variants: [...variants],
    hostnameTokens,
    pathTokens,
  };
}

function scoreEntryForCurrentTab(entry, context = currentTabMatchContext()) {
  if (!context) {
    return 0;
  }

  const normalizedEntry = entry.toLowerCase();
  const entrySegments = normalizedEntry.split("/").filter(Boolean);
  if (entrySegments.length === 0) {
    return 0;
  }

  const basename = entrySegments.at(-1) || "";
  const entryTokens = new Set(tokenizeText(normalizedEntry));
  let score = 0;

  for (const variant of context.variants) {
    if (basename === variant) {
      score += 1200;
    } else if (entrySegments.includes(variant)) {
      score += 900;
    } else if (basename.includes(variant)) {
      score += 700;
    } else if (normalizedEntry.includes(variant)) {
      score += 520;
    }
  }

  for (const token of context.hostnameTokens) {
    if (basename === token) {
      score += 260;
    } else if (entrySegments.includes(token)) {
      score += 190;
    } else if (entryTokens.has(token)) {
      score += 80;
    }
  }

  for (const token of context.pathTokens) {
    if (basename === token) {
      score += 80;
    } else if (entryTokens.has(token)) {
      score += 25;
    }
  }

  score -= entrySegments.length * 4;
  return score;
}

function bestMatchingEntryForCurrentTab(entries) {
  const context = currentTabMatchContext();
  if (!context) {
    return null;
  }

  const rankedEntries = entries
  .map((entry) => ({
    entry,
    score: scoreEntryForCurrentTab(entry, context),
  }))
  .filter((candidate) => candidate.score >= 160)
  .sort((left, right) => right.score - left.score || left.entry.length - right.entry.length || left.entry.localeCompare(right.entry));

  return rankedEntries[0]?.entry || null;
}

function createEntryIcon(entry,icon_id,div,hint_text,clickHandler) {
  let icon_svg = null;
  const svg = document.getElementById(icon_id);

  if(!svg)
    return;

  icon_svg = svg.cloneNode(true);
  icon_svg.id = null;

  const icon_div = document.createElement("div");
  icon_div.classList.add("icon","entry-icon");
  icon_div.append(icon_svg);
  icon_div.dataset.entry = entry;
  icon_div.title = hint_text;
  icon_div.addEventListener("click", clickHandler);
  div.append(icon_div);
}

function createEntry(entry) {
  const item = document.createElement("div");
  item.className = "entry";
  if (entry === selectedEntry) {
    item.classList.add("selected");
  }

  const text_div = document.createElement("div");
  text_div.className = "entry-text";
  const path_components = entry.split("/");
  const entry_name = path_components.pop();
  const entry_folder = path_components.join("/");
  const folder_div = document.createElement("div");
  folder_div.className = "entry-folder";
  folder_div.append(document.createTextNode(entry_folder));
  text_div.append(folder_div);
  const name_div = document.createElement("div");
  name_div.className = "entry-name";
  name_div.append(document.createTextNode(entry_name));
  text_div.append(name_div);
  text_div.title = "Click to autofill form";
  text_div.dataset.entry = entry;
  text_div.addEventListener("click", onEntryTitleClick);
  item.append(text_div);
  
  const entry_buttons_div = document.createElement("div");
  entry_buttons_div.className = "entry-buttons";

  createEntryIcon(entry,"icon-user",entry_buttons_div,"Copy username",onCopyUsernameClicked);
  createEntryIcon(entry,"icon-password",entry_buttons_div,"Copy password",onCopyPasswordClick);
  createEntryIcon(entry,"icon-link",entry_buttons_div,"Open URL",openURLClicked);
  createEntryIcon(entry,"icon-show",entry_buttons_div,"Show entry",onShowEntryClick);
  createEntryIcon(entry,"icon-edit",entry_buttons_div,"Edit entry",onEditEntryClick);

  item.append(entry_buttons_div);
  return item;
}

async function openURLClicked() {
  const entry = this.dataset.entry;
  
  if(!entry)
    return;

  if(selectedEntry !== entry || !selectedEntryDetails)
    await getEntryData(entry);

  onOpenURLClick();
}

async function onShowEntryClick() {
  const entry = this.dataset.entry;
  
  if(!entry)
    return;

  if(selectedEntry !== entry || !selectedEntryDetails)
    await getEntryData(entry);

  renderEntryDetails(selectedEntryDetails);
}

function onCloseDetailsClicked() {
  detailPanelElement.hidden = true;
  editPanelElement.hidden = true;
  mainPanelElement.hidden = false;
}

async function onEntryTitleClick() {
  const entry = this.dataset.entry;
  
  if(!entry)
    return;

  if(selectedEntry !== entry || !selectedEntryDetails)
    await getEntryData(entry);

  onAutofillEntryClick();
}

async function onCopyUsernameClicked() {
  const entry = this.dataset.entry;
  
  if(!entry)
    return;

  if(selectedEntry !== entry || !selectedEntryDetails)
    await getEntryData(entry);

  onCopyFieldClick("username");
}

async function onCopyPasswordClick() {
  const entry = this.dataset.entry;
  
  if(!entry)
    return;

  if(selectedEntry !== entry || !selectedEntryDetails)
    await getEntryData(entry);

  onCopyFieldClick("password");
}


function renderEntries() {
  const activeEntry = document.activeElement?.classList?.contains("entry-button")
    ? document.activeElement.dataset.entry
    : null;
  const filteredEntries = getFilteredEntries();

  // Clear selection if the selected entry is no longer visible
  if (selectedEntry && !filteredEntries.includes(selectedEntry)) {
    clearSelectedEntry();
  }

  entriesElement.replaceChildren();
  suggestionsElement.replaceChildren();

  const searchText = searchInput.value.trim();

  suggestionsArea.hidden = allSuggestions.length === 0 || searchText !== "";
  const suggestionItems = allSuggestions.map((entry) => createEntry(entry));
  suggestionsElement.append(...suggestionItems);
  suggestionsCounter.textContent = `${allSuggestions.length}`

  const items = filteredEntries.map((entry) => createEntry(entry));
  entriesElement.append(...items);

  if(searchText !== "") {
    entriesHeaderTitle.textContent = "Matched entries";
    entriesCounter.textContent = `${items.length}`
  }
  else {
    entriesHeaderTitle.textContent = "Entries";
    entriesCounter.textContent = `${allEntries.length}`
  }

  if (activeEntry) {
    focusEntryButtonByEntryName(activeEntry) || focusEntryButtonByEntryName(selectedEntry) || focusEntryButtonAtIndex(0);
  } else if (selectedEntry) {
    const selectedButton = getVisibleEntryButtons().find((candidate) => candidate.dataset.entry === selectedEntry);
    selectedButton?.scrollIntoView({ block: "nearest" });
  }
}

function getFilteredEntries() {
  const query = searchInput.value.trim().toLowerCase();
  return allEntries.filter((entry) => entry.toLowerCase().includes(query));
}

function getVisibleEntryButtons() {
  return [...entriesElement.querySelectorAll(".entry-button")];
}

function focusSearchInput() {
  searchInput.focus();

  const textLength = searchInput.value.length;
  if (typeof searchInput.setSelectionRange === "function") {
    searchInput.setSelectionRange(textLength, textLength);
  }
}

function focusSearchInputWithQuery(value) {
  searchInput.value = value;
  renderEntries();
  focusSearchInput();
}

function isSearchEditingKey(event) {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;
}

function moveListKeyboardInputToSearch(event) {
  if (isSearchEditingKey(event)) {
    event.preventDefault();
    focusSearchInputWithQuery(`${searchInput.value}${event.key}`);
    return true;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    focusSearchInputWithQuery(searchInput.value.slice(0, -1));
    return true;
  }

  if (event.key === "Delete") {
    event.preventDefault();
    focusSearchInputWithQuery("");
    return true;
  }

  return false;
}

function focusEntryButtonAtIndex(index) {
  const buttons = getVisibleEntryButtons();
  if (buttons.length === 0) {
    return false;
  }

  const boundedIndex = Math.max(0, Math.min(index, buttons.length - 1));
  const button = buttons[boundedIndex];
  button.scrollIntoView({ block: "nearest" });
  button.focus();
  return true;
}

function moveFocusFromSearchToEntries(direction) {
  const filteredEntries = getFilteredEntries();
  if (filteredEntries.length === 0) {
    return false;
  }

  const selectedEntryIndex = selectedEntry ? filteredEntries.indexOf(selectedEntry) : -1;
  const fallbackIndex = direction === "up" ? filteredEntries.length - 1 : 0;
  const targetIndex = selectedEntryIndex >= 0 ? selectedEntryIndex : fallbackIndex;

  requestAnimationFrame(() => {
    focusEntryButtonAtIndex(targetIndex);
  });

  return true;
}

function focusEntryButtonByEntryName(entryName) {
  if (!entryName) {
    return false;
  }

  const button = getVisibleEntryButtons().find((candidate) => candidate.dataset.entry === entryName);
  if (!button) {
    return false;
  }

  button.focus();
  button.scrollIntoView({ block: "nearest" });
  return true;
}

function triggerPreferredSelectedEntryAction() {
  if (shouldPreferAutofillSelectedEntry()) {
    void onAutofillEntryClick();
  } else {
    autofillEntryButton.focus();
  }
}

function onSearchKeyDown(event) {
  const filteredEntries = getFilteredEntries();

  if (event.key === "Enter") {
    const hasSelectedVisibleEntry = Boolean(selectedEntryDetails && selectedEntry && filteredEntries.includes(selectedEntry));
    const isModifierAutofillShortcut = (event.metaKey || event.ctrlKey) && hasSelectedVisibleEntry;

    if (isModifierAutofillShortcut) {
      event.preventDefault();
      triggerPreferredSelectedEntryAction();
      return;
    }

    if (filteredEntries.length === 0) {
      return;
    }

    event.preventDefault();

    const trimmedQuery = searchInput.value.trim();
    if (!trimmedQuery && hasSelectedVisibleEntry) {
      triggerPreferredSelectedEntryAction();
      return;
    }

    const firstFilteredEntry = filteredEntries[0];
    if (selectedEntryDetails && selectedEntry === firstFilteredEntry) {
      triggerPreferredSelectedEntryAction();
    } else {
      void onEntryClick(firstFilteredEntry, { preserveSearchFocus: true });
    }
    return;
  }

  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }

  event.preventDefault();

  if (filteredEntries.length === 0) {
    return;
  }

  moveFocusFromSearchToEntries(event.key === "ArrowUp" ? "up" : "down");
}

function onEntriesKeyDown(event) {
  const button = event.target.closest(".entry-button");
  if (!button) {
    return;
  }

  const buttons = getVisibleEntryButtons();
  const currentIndex = buttons.indexOf(button);
  if (currentIndex < 0) {
    return;
  }

  switch (event.key) {
    case "Enter":
      event.preventDefault();
      if (selectedEntryDetails && selectedEntry === button.dataset.entry) {
        triggerPreferredSelectedEntryAction();
      } else {
        void onEntryClick(button.dataset.entry, { preserveSearchFocus: true });
      }
      break;
    case "ArrowDown":
      event.preventDefault();
      focusEntryButtonAtIndex(currentIndex + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      if (currentIndex === 0) {
        focusSearchInput();
      } else {
        focusEntryButtonAtIndex(currentIndex - 1);
      }
      break;
    case "Home":
      event.preventDefault();
      focusEntryButtonAtIndex(0);
      break;
    case "End":
      event.preventDefault();
      focusEntryButtonAtIndex(buttons.length - 1);
      break;
    default:
      moveListKeyboardInputToSearch(event);
      break;
  }
}

function canAutofillSelectedEntry() {
  return Boolean(selectedEntryDetails && ((selectedEntryDetails.password || "").length || (selectedEntryDetails.username || "").length || (selectedEntryDetails.otp || "").length));
}

function parsedURL(rawURL) {
  try {
    return rawURL ? new URL(rawURL) : null;
  } catch {
    return null;
  }
}

function doHostsMatch(leftHostname, rightHostname) {
  return leftHostname === rightHostname || leftHostname.endsWith(`.${rightHostname}`) || rightHostname.endsWith(`.${leftHostname}`);
}

function getSelectedEntryURLMatchState(details = selectedEntryDetails) {
  if (!details?.url) {
    return "missing";
  }

  const storedURL = parsedURL(details.url);
  const activeURL = parsedURL(currentTabURL);
  if (!storedURL || !activeURL) {
    return "unknown";
  }

  return doHostsMatch(storedURL.hostname, activeURL.hostname) ? "match" : "mismatch";
}

function getEntryDetailsSubtitle(details) {
  switch (getSelectedEntryURLMatchState(details)) {
    case "match":
      return "Saved URL matches the current tab.";
    case "mismatch":
      return "Saved URL differs from the current tab. Click Autofill to continue anyway.";
    default:
      return "Entry details loaded.";
  }
}

function shouldPreferAutofillSelectedEntry() {
  if (!canAutofillSelectedEntry()) {
    return false;
  }

  if (!selectedEntryDetails?.url) {
    return true;
  }

  return getSelectedEntryURLMatchState() === "match";
}

function maskSecretValue(value) {
  return value ? "•".repeat(Math.max(8, Math.min(value.length, 16))) : "";
}

function otpRefreshType(details = selectedEntryDetails) {
  return typeof details?.otpType === "string" ? details.otpType.toLowerCase() : "";
}

function otpRefreshPeriod(details = selectedEntryDetails) {
  const rawPeriod = Number(details?.otpPeriod);
  return Number.isInteger(rawPeriod) && rawPeriod > 0 ? rawPeriod : 30;
}

function currentOTPBucket(details = selectedEntryDetails) {
  if (otpRefreshType(details) !== "totp") {
    return null;
  }

  return Math.floor(Date.now() / 1000 / otpRefreshPeriod(details));
}

function updateOTPLabel(details = selectedEntryDetails) {
  if (otpRefreshType(details) !== "totp" || !(details?.otp || "").length) {
    detailOTPLabelElement.textContent = "One-time code";
    return;
  }

  const period = otpRefreshPeriod(details);
  const epochSeconds = Math.floor(Date.now() / 1000);
  const elapsedInPeriod = epochSeconds % period;
  const remainingSeconds = elapsedInPeriod === 0 ? period : period - elapsedInPeriod;
  detailOTPLabelElement.textContent = `One-time code · refreshes in ${remainingSeconds}s`;
}

function stopOTPRefreshLoop() {
  if (otpRefreshIntervalHandle !== null) {
    clearInterval(otpRefreshIntervalHandle);
    otpRefreshIntervalHandle = null;
  }

  otpRefreshInFlight = false;
  otpRefreshLastBucket = null;
  updateOTPLabel();
}

async function refreshSelectedEntryOTP() {
  if (!selectedEntry || otpRefreshInFlight) {
    return;
  }

  otpRefreshInFlight = true;

  try {
    const response = await sendNativeMessage({
      command: "getEntryOTP",
      entry: selectedEntry,
    });

    if (response?.storePath) {
      applyStoreConfiguration(response);
    }

    if (selectedEntry !== response?.entry) {
      return;
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to refresh one-time code.");
    }

    if (!selectedEntryDetails) {
      return;
    }

    selectedEntryDetails.otp = typeof response.otp === "string" ? response.otp : "";
    if (typeof response.otpType === "string") {
      selectedEntryDetails.otpType = response.otpType;
    }
    if (Number.isInteger(response.otpPeriod)) {
      selectedEntryDetails.otpPeriod = response.otpPeriod;
    }

    detailOTPRowElement.hidden = !(selectedEntryDetails.otp || "").length;
    detailOTPElement.textContent = selectedEntryDetails.otp || "";
    copyOTPButton.disabled = !(selectedEntryDetails.otp || "").length;
    updateOTPLabel();
  } catch (error) {
    console.warn("Unable to refresh one-time code.", error);
  } finally {
    otpRefreshInFlight = false;
  }
}

function startOTPRefreshLoop() {
  stopOTPRefreshLoop();

  if (otpRefreshType() !== "totp" || !(selectedEntryDetails?.otp || "").length) {
    return;
  }

  otpRefreshLastBucket = currentOTPBucket();
  updateOTPLabel();

  otpRefreshIntervalHandle = setInterval(() => {
    updateOTPLabel();

    const currentBucket = currentOTPBucket();
    if (currentBucket === null || currentBucket === otpRefreshLastBucket) {
      return;
    }

    otpRefreshLastBucket = currentBucket;
    void refreshSelectedEntryOTP();
  }, 1000);
}

function updatePasswordVisibility() {
  const password = typeof selectedEntryDetails?.password === "string" ? selectedEntryDetails.password : "";
  detailPasswordElement.textContent = isPasswordVisible ? password : maskSecretValue(password);
  togglePasswordButton.innerHTML = isPasswordVisible ? togglePasswordButton.dataset.hide_icon : togglePasswordButton.dataset.show_icon;
  togglePasswordButton.setAttribute("aria-label", isPasswordVisible ? "Hide password" : "Show password");
  togglePasswordButton.title = isPasswordVisible ? "Hide password" : "Show password";
  togglePasswordButton.setAttribute("aria-pressed", String(isPasswordVisible));
  togglePasswordButton.disabled = !password.length;
}

function updateAutofillButtonState() {
  const canAutofill = canAutofillSelectedEntry();
  autofillEntryButton.disabled = !canAutofill;

  if (!canAutofill) {
    autofillEntryButton.title = "Autofill unavailable";
    autofillEntryButton.removeAttribute("aria-keyshortcuts");
    return;
  }

  if (shouldPreferAutofillSelectedEntry()) {
    autofillEntryButton.title = "Shortcuts: Enter, Cmd+Enter, Ctrl+Enter";
    autofillEntryButton.setAttribute("aria-keyshortcuts", "Enter Meta+Enter Control+Enter");
    return;
  }

  if (selectedEntryDetails?.url && getSelectedEntryURLMatchState() === "mismatch") {
    autofillEntryButton.title = "Saved URL differs from the current tab. Click to autofill anyway, or use Cmd+Enter / Ctrl+Enter.";
    autofillEntryButton.setAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
    return;
  }

  autofillEntryButton.title = "Click to autofill. Shortcuts: Cmd+Enter, Ctrl+Enter";
  autofillEntryButton.setAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
}

function renderEntryDetails(details) {
  mainPanelElement.hidden = true;
  editPanelElement.hidden = true;
  detailPanelElement.hidden = false;

  stopOTPRefreshLoop();
  isPasswordVisible = false;
  detailsTitleElement.textContent = details.entry || selectedEntry || "Entry details";
  setDetailStatus("");

  const password = typeof details.password === "string" ? details.password : "";
  detailPasswordRowElement.hidden = !password;
  copyPasswordButton.disabled = !(details.password || "").length;

  const username = typeof details.username === "string" ? details.username : "";
  detailUsernameRowElement.hidden = !username;
  detailUsernameElement.textContent = username;
  copyUsernameButton.disabled = !username;

  const otp = typeof details.otp === "string" ? details.otp : "";
  detailOTPRowElement.hidden = !otp;
  detailOTPElement.textContent = otp;
  copyOTPButton.disabled = !otp;

  const url = typeof details.url === "string" ? details.url : "";
  detailURLRowElement.hidden = !url;
  detailURLElement.textContent = url;
  openURLButton.disabled = !url;

  const fields = Array.isArray(details.fields) ? details.fields : [];
  detailAdditionalFields.hidden = fields.length === 0;
  detailAdditionalFields.replaceChildren();

  if (fields.length > 0) {
    const fieldItems = fields.map((field) => {

      const div = document.createElement("div");
      div.className = "detail-row";

      const label = document.createElement("div");
      label.className = "detail-label";
      label.textContent = field.label || "Field";
      div.append(label);

      const body = document.createElement("div");
      body.className = "detail-body";
      const value = document.createElement("div");
      value.className = "detail-value";
      value.textContent = field.value || "";
      body.append(value);

      const svg = document.getElementById("icon-copy");
      if(svg) {
        const icon_svg = svg.cloneNode(true);
        icon_svg.id = null;
        const action = document.createElement("div");
        action.className = "detail-action";
        const button = document.createElement("button");
        button.className = "icon";
        button.title = "Copy value";
        button.append(icon_svg);
        button.addEventListener("click", () => copyText(field.value));
        action.append(button);
        body.append(action);
      }

      div.append(body);

      return div;
    });

    detailAdditionalFields.append(...fieldItems);
  }

  const notes = typeof details.notes === "string" ? details.notes : "";
  detailNotesRowElement.hidden = !notes;
  detailNotesElement.textContent = notes;

  updatePasswordVisibility();
  updateAutofillButtonState();
  updateOTPLabel(details);
  startOTPRefreshLoop();
}

function clearSelectedEntry() {
  selectedEntry = null;
  selectedEntryDetails = null;
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function setDetailStatus(message, isError = false) {
  detailsStatusElement.textContent = message;
  detailsStatusElement.classList.toggle("error", isError);
  detailsStatusElement.hidden = !message;
}

function setBusy(isBusy) {
  chooseStoreButton.disabled = isBusy;
  useDefaultButton.disabled = isBusy || usingDefaultStore;
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

async function refreshActiveTabContext() {
  const tabs = await queryActiveTab();
  const activeTab = Array.isArray(tabs) ? tabs[0] : null;
  currentTabURL = typeof activeTab?.url === "string" ? activeTab.url : "";
  return activeTab;
}

async function sendMessageToActiveTab(message) {
  const activeTab = await refreshActiveTabContext();

  if (!activeTab?.id) {
    throw new Error("Unable to find the active Safari tab.");
  }

  return sendMessageToTab(activeTab.id, message);
}

async function queryActiveTab() {
  if (globalThis.browser?.tabs?.query) {
    return globalThis.browser.tabs.query({ active: true, currentWindow: true });
  }

  if (globalThis.chrome?.tabs?.query) {
    return new Promise((resolve, reject) => {
      globalThis.chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const runtimeError = globalThis.chrome.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(tabs || []);
      });
    });
  }

  throw new Error("Tab access is not available in this browser.");
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

function onNewEntryClick() {
  newEntry = true;
  openEditPanel();
}

