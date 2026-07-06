//
//  AppDelegate.swift
//  pass-safari
//
//  Created by Mario Zimmermann on 15.06.26.
//

import Cocoa
import Darwin

private let appGroupIdentifier = "group.de.zisoft.pass-safari"
private let sharedContainerDirectoryName = "pass-safari"
private let storeBookmarkKey = "PasswordStoreBookmark"
private let storePathKey = "PasswordStorePath"
private let storeSelectionFileName = "PasswordStoreSelection.plist"
private let storeSelectionEventFileName = "PasswordStoreSelectionEvent.plist"
private let passRequestFileNamePrefix = "PassRequest-"
private let passResponseFileNamePrefix = "PassResponse-"
private let urlIndexCacheFileName = "URLIndexCache.json"
private let urlIndexRefreshLockFileName = "URLIndexRefresh.lock"
private let chooseStoreFolderURLHost = "choose-store-folder"
private let runPassURLHost = "run-pass"
private let refreshURLIndexURLHost = "refresh-url-index"
private let mainWindowControllerStoryboardIdentifier = "MainWindowController"

private struct StoreConfiguration {
  let url: URL
  let requiresSecurityScope: Bool
}

private struct PassRequest {
  let command: PassRequestCommand
  let entry: String?
  let content: String?
}

private struct StoreInventoryEntry: Hashable {
  let path: String
  let modificationTime: TimeInterval
}

private struct StoreInventory {
  let entries: [StoreInventoryEntry]
  let latestModificationTime: TimeInterval
}

private struct URLIndexCache: Codable {
  var storePath: String
  var entryCount: Int
  var latestStoreModificationTime: TimeInterval
  var generatedAt: TimeInterval
  var entries: [String: URLIndexCacheEntry]

  init(
    storePath: String = "",
    entryCount: Int = 0,
    latestStoreModificationTime: TimeInterval = 0,
    generatedAt: TimeInterval = 0,
    entries: [String: URLIndexCacheEntry] = [:]
  ) {
    self.storePath = storePath
    self.entryCount = entryCount
    self.latestStoreModificationTime = latestStoreModificationTime
    self.generatedAt = generatedAt
    self.entries = entries
  }
}

private struct URLIndexCacheEntry: Codable {
  let hosts: [String]
  let urls: [String]
  let modificationTime: TimeInterval
}

private struct OTPDetails {
  let code: String
  let type: String?
  let period: Int?
}

private enum SharedContainerKind {
  case state
  case cache
}

private enum PassRequestCommand: String {
  case getEntryDetails
  case getEntryOTP
  case updateEntry
  case deleteEntry
  case syncStore
}

private enum PassError: LocalizedError {
  case missingEntryName
  case passExecutableNotFound
  case executionFailed(String)

  var errorDescription: String? {
    switch self {
    case .missingEntryName:
      return "No pass entry was specified."
    case .passExecutableNotFound:
      return "Unable to find the 'pass' executable."
    case .executionFailed(let message):
      return message
    }
  }
}

@main
class AppDelegate: NSObject, NSApplicationDelegate {
  private let defaultStorePath = "~/.password-store"
  private let passExecutableCandidates = [
    "/opt/homebrew/bin/pass",
    "/usr/local/bin/pass",
    "/usr/bin/pass",
    "/bin/pass",
  ]
  private var suppressAutomaticWindowPresentation = false
  private var mainWindowController: NSWindowController?

  func applicationDidFinishLaunching(_ notification: Notification) {

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
      guard !self.suppressAutomaticWindowPresentation else {
        return
      }

      self.showMainWindowIfNeeded()
    }
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    suppressAutomaticWindowPresentation = true

    if let chooserURL = urls.first(where: isChooseStoreFolderURL(_:)) {
      let requestID = requestID(from: chooserURL)

      DispatchQueue.main.async {
        self.presentStoreChooser(requestID: requestID)
      }
      return
    }

    if let passURL = urls.first(where: isRunPassURL(_:)) {
      let requestID = requestID(from: passURL)

      DispatchQueue.global(qos: .userInitiated).async {
        self.handlePassRequest(requestID: requestID)
      }
      return
    }

    if urls.contains(where: isRefreshURLIndexURL(_:)) {
      DispatchQueue.global(qos: .utility).async {
        self.refreshURLIndex()
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    if !flag {
      showMainWindowIfNeeded()
    }

    return true
  }

  private func showMainWindowIfNeeded() {
    if mainWindowController == nil {
      let storyboard = NSStoryboard(name: NSStoryboard.Name("Main"), bundle: nil)
      mainWindowController =
        storyboard.instantiateController(
          withIdentifier: NSStoryboard.SceneIdentifier(mainWindowControllerStoryboardIdentifier)
        ) as? NSWindowController
    }

    mainWindowController?.showWindow(nil)
    mainWindowController?.window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func normalizedHost(from rawHost: String?) -> String? {
    guard let trimmedHost = rawHost?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
      !trimmedHost.isEmpty
    else {
      return nil
    }

    return trimmedHost.hasPrefix("www.") ? String(trimmedHost.dropFirst(4)) : trimmedHost
  }

  private func isChooseStoreFolderURL(_ url: URL) -> Bool {
    url.scheme == "pass-safari" && url.host == chooseStoreFolderURLHost
  }

  private func isRunPassURL(_ url: URL) -> Bool {
    url.scheme == "pass-safari" && url.host == runPassURLHost
  }

  private func isRefreshURLIndexURL(_ url: URL) -> Bool {
    url.scheme == "pass-safari" && url.host == refreshURLIndexURLHost
  }

  private func requestID(from url: URL) -> String? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?
      .first(where: { $0.name == "requestId" })?
      .value
  }

  private func presentStoreChooser(requestID: String?) {
    defer {
      NSApp.terminate(nil)
    }

    NSApp.windows.forEach { $0.orderOut(nil) }
    //_ = NSRunningApplication.current.activate(options: [.activateIgnoringOtherApps])

    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = false
    panel.resolvesAliases = true
    panel.prompt = "Choose Folder"
    panel.message = "Choose your pass password-store folder."
    panel.directoryURL = initialDirectoryURL()

    guard panel.runModal() == .OK, let selectedURL = panel.url?.standardizedFileURL else {
      if let requestID {
        try? writeStoreSelectionEvent(requestID: requestID, status: "cancelled")
      }
      return
    }

    do {
      let bookmarkData = try selectedURL.bookmarkData(
        options: [.withSecurityScope],
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )

      try persistStoreSelection(path: selectedURL.path, bookmarkData: bookmarkData)
      if let requestID {
        try writeStoreSelectionEvent(requestID: requestID, status: "selected")
      }
    } catch {
      NSLog("Failed to store selected password-store bookmark: %@", error.localizedDescription)
      if let requestID {
        try? writeStoreSelectionEvent(requestID: requestID, status: "cancelled")
      }
    }
  }

  private func handlePassRequest(requestID: String?) {
    guard let requestID, !requestID.isEmpty else {
      NSLog("[App] handlePassRequest called with empty requestID")
      return
    }

    NSLog("[App] Handling pass request: %@", requestID)

    defer {
      DispatchQueue.main.async {
        NSApp.terminate(nil)
      }
    }

    do {
      defer {
        try? removePassRequestFile(requestID: requestID)
      }

      let request = try readPassRequest(requestID: requestID)
      NSLog(
        "[App] Pass request read: command=%@, entry=%@", request.command.rawValue,
        request.entry ?? "(none)")
      let response: [String: Any]

      switch request.command {
      case .getEntryDetails:
        let entryName = try normalizedEntryName(from: request.entry)
        let configuration = try resolvedStoreConfiguration()
        let (output, otpDetails) = try withStoreAccess(configuration) {
          let output = try runPass(arguments: ["show", entryName], configuration: configuration)
          let otpDetails = try? resolvedOTPDetails(for: entryName, configuration: configuration)
          return (output, otpDetails)
        }

        response = [
          "requestId": requestID,
          "ok": true,
          "entry": entryName,
          "output": output,
          "otp": otpDetails?.code ?? "",
          "otpType": otpDetails?.type ?? "",
          "otpPeriod": otpDetails?.period ?? 0,
        ]
      case .getEntryOTP:
        let entryName = try normalizedEntryName(from: request.entry)
        let configuration = try resolvedStoreConfiguration()
        let otpDetails = try withStoreAccess(configuration) {
          try resolvedOTPDetails(for: entryName, configuration: configuration)
        }

        response = [
          "requestId": requestID,
          "ok": true,
          "entry": entryName,
          "otp": otpDetails.code,
          "otpType": otpDetails.type ?? "",
          "otpPeriod": otpDetails.period ?? 0,
        ]
      case .updateEntry:
        let entryName = try normalizedEntryName(from: request.entry)
        guard let content = request.content, !content.isEmpty else {
          throw PassError.executionFailed("Entry content is required.")
        }

        let configuration = try resolvedStoreConfiguration()
        try withStoreAccess(configuration) {
          try updatePassEntry(entryName: entryName, content: content, configuration: configuration)
        }

        response = [
          "requestId": requestID,
          "ok": true,
          "entry": entryName,
        ]
      case .deleteEntry:
        let entryName = try normalizedEntryName(from: request.entry)

        let configuration = try resolvedStoreConfiguration()
        try withStoreAccess(configuration) {
          try deletePassEntry(entryName: entryName, configuration: configuration)
        }

        response = [
          "requestId": requestID,
          "ok": true,
        ]
      case .syncStore:
        let configuration = try resolvedStoreConfiguration()
        try withStoreAccess(configuration) {
          try gitPull(configuration: configuration)
          try gitPush(configuration: configuration)
        }

        response = [
          "requestId": requestID,
          "ok": true,
        ]

      }

      try writePassResponse(requestID: requestID, payload: response)
    } catch {
      try? writePassResponse(
        requestID: requestID,
        payload: [
          "requestId": requestID,
          "ok": false,
          "error": error.localizedDescription,
        ])
    }
  }

  private func refreshURLIndex() {
    defer {
      DispatchQueue.main.async {
        NSApp.terminate(nil)
      }
    }

    guard acquireURLIndexRefreshLock() else {
      return
    }

    defer {
      releaseURLIndexRefreshLock()
    }

    do {
      let configuration = try resolvedStoreConfiguration()
      var cache = (try? readURLIndexCache()) ?? URLIndexCache()
      var cacheUpdated = false

      try withStoreAccess(configuration) {
        let inventory = try storeInventory(in: configuration)

        // remove entries from cache which no longer exist in inventory
        let cache_set = Set(cache.entries.keys)
        let inventory_set = Set(inventory.entries.map({ $0.path }))
        let diff = inventory_set.symmetricDifference(cache_set)

        for path in diff {
          if cache.entries.keys.contains(path) {
            cache.entries.removeValue(forKey: path)
            cacheUpdated = true
          }
        }
        cache.entryCount = cache.entries.count

        if !cacheUpdated && cache.entries.count == inventory.entries.count
          && cache.generatedAt > inventory.latestModificationTime
        {
          // nothing to do
          return
        }

        for entry in inventory.entries {
          do {
            var refreshNeeded = false
            if let entryCache = cache.entries[entry.path] {
              refreshNeeded = entry.modificationTime > entryCache.modificationTime
            } else {
              refreshNeeded = true
            }

            if refreshNeeded {
              print(entry.path)
              let output = try runPass(
                arguments: ["show", entry.path], configuration: configuration)
              if let entryCache = urlIndexEntry(for: entry, from: output) {
                cache.entries[entry.path] = entryCache
                cacheUpdated = true
              }
            }
          } catch {
            NSLog("Failed to index pass entry %@: %@", entry.path, error.localizedDescription)
          }
        }

        if cacheUpdated {
          cache.storePath = configuration.url.path
          cache.entryCount = cache.entries.count
          cache.latestStoreModificationTime = inventory.latestModificationTime
          cache.generatedAt = Date().timeIntervalSince1970
          try writeURLIndexCache(cache)
        }
      }

    } catch {
      NSLog("Failed to refresh URL index: %@", error.localizedDescription)
    }
  }

  private func initialDirectoryURL() -> URL {
    if let storedSelection = storedStoreSelection() {
      return URL(fileURLWithPath: storedSelection.path, isDirectory: true)
    }

    let defaultURL = URL(fileURLWithPath: resolvedDefaultStorePath(), isDirectory: true)
    return defaultURL.deletingLastPathComponent()
  }

  private func persistStoreSelection(path: String, bookmarkData: Data) throws {
    let payload: [String: Any] = [
      storePathKey: path,
      storeBookmarkKey: bookmarkData,
    ]

    let plistData = try PropertyListSerialization.data(
      fromPropertyList: payload, format: .binary, options: 0)
    let fileURL = try storeSelectionFileURL()
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try plistData.write(to: fileURL, options: .atomic)

  }

  private func storedStoreSelection() -> (path: String, bookmarkData: Data)? {
    try? readStoreSelectionFromFile()
  }

  private func readStoreSelectionFromFile() throws -> (path: String, bookmarkData: Data) {
    let data = try Data(contentsOf: storeSelectionFileURL())
    let propertyList = try PropertyListSerialization.propertyList(from: data, format: nil)

    guard let payload = propertyList as? [String: Any],
      let path = payload[storePathKey] as? String,
      let bookmarkData = payload[storeBookmarkKey] as? Data,
      !path.isEmpty
    else {
      throw CocoaError(.fileReadCorruptFile)
    }

    return (path: path, bookmarkData: bookmarkData)
  }

  private func readPassRequest(requestID: String) throws -> PassRequest {
    let filename = try passRequestFileURL(requestID: requestID)
    NSLog("[App] Reading pass request from: %@", filename.path)

    guard FileManager.default.fileExists(atPath: filename.path) else {
      NSLog("[App] Pass request file does not exist!")
      throw CocoaError(.fileNoSuchFile)
    }

    let data = try Data(contentsOf: filename)
    let propertyList = try PropertyListSerialization.propertyList(from: data, format: nil)

    guard let payload = propertyList as? [String: Any],
      let rawCommand = payload["command"] as? String,
      let command = PassRequestCommand(rawValue: rawCommand)
    else {
      NSLog("[App] Invalid pass request format")
      throw CocoaError(.fileReadCorruptFile)
    }

    return PassRequest(
      command: command,
      entry: payload["entry"] as? String,
      content: payload["content"] as? String
    )
  }

  private func writePassResponse(requestID: String, payload: [String: Any]) throws {
    let plistData = try PropertyListSerialization.data(
      fromPropertyList: payload, format: .binary, options: 0)
    let fileURL = try passResponseFileURL(requestID: requestID)
    NSLog("[App] Writing pass response to: %@", fileURL.path)
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try plistData.write(to: fileURL, options: .atomic)
    NSLog("[App] Pass response written successfully")
  }

  private func removePassRequestFile(requestID: String) throws {
    let fileURL = try passRequestFileURL(requestID: requestID)
    if FileManager.default.fileExists(atPath: fileURL.path) {
      try FileManager.default.removeItem(at: fileURL)
    }
  }

  private func writeStoreSelectionEvent(requestID: String, status: String) throws {
    let payload: [String: Any] = [
      "requestId": requestID,
      "status": status,
    ]

    let plistData = try PropertyListSerialization.data(
      fromPropertyList: payload, format: .binary, options: 0)
    let fileURL = try storeSelectionEventFileURL()
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try plistData.write(to: fileURL, options: .atomic)
  }

  private func storeSelectionFileURL() throws -> URL {
    try resolvedSharedFileURL(
      fileName: storeSelectionFileName, kind: .state, migrateLegacyFile: true)
  }

  private func storeSelectionEventFileURL() throws -> URL {
    try resolvedSharedFileURL(fileName: storeSelectionEventFileName, kind: .state)
  }

  private func passRequestFileURL(requestID: String) throws -> URL {
    try resolvedSharedFileURL(
      fileName: "\(passRequestFileNamePrefix)\(requestID).plist", kind: .state)
  }

  private func passResponseFileURL(requestID: String) throws -> URL {
    try resolvedSharedFileURL(
      fileName: "\(passResponseFileNamePrefix)\(requestID).plist", kind: .state)
  }

  private func urlIndexCacheFileURL() throws -> URL {
    try resolvedSharedFileURL(
      fileName: urlIndexCacheFileName, kind: .cache, migrateLegacyFile: true)
  }

  private func urlIndexRefreshLockFileURL() throws -> URL {
    try resolvedSharedFileURL(fileName: urlIndexRefreshLockFileName, kind: .cache)
  }

  private func writeURLIndexCache(_ cache: URLIndexCache) throws {
    let data = try JSONEncoder().encode(cache)
    try data.write(to: urlIndexCacheFileURL(), options: .atomic)
  }

  private func readURLIndexCache() throws -> URLIndexCache {
    let data = try Data(contentsOf: urlIndexCacheFileURL())
    let cache = try JSONDecoder().decode(URLIndexCache.self, from: data)
    return cache
  }

  private func acquireURLIndexRefreshLock() -> Bool {
    guard let lockFileURL = try? urlIndexRefreshLockFileURL() else {
      return false
    }

    let fileManager = FileManager.default
    if fileManager.fileExists(atPath: lockFileURL.path) {
      if let values = try? lockFileURL.resourceValues(forKeys: [.contentModificationDateKey]),
        let modificationDate = values.contentModificationDate,
        Date().timeIntervalSince(modificationDate) > 7200
      {
        try? fileManager.removeItem(at: lockFileURL)
      } else {
        return false
      }
    }

    let didCreate = fileManager.createFile(
      atPath: lockFileURL.path, contents: Data(), attributes: [.posixPermissions: 0o600])
    return didCreate
  }

  private func releaseURLIndexRefreshLock() {
    if let lockFileURL = try? urlIndexRefreshLockFileURL() {
      try? FileManager.default.removeItem(at: lockFileURL)
    }
  }

  private func resolvedSharedFileURL(
    fileName: String, kind: SharedContainerKind, migrateLegacyFile: Bool = false
  ) throws -> URL {
    try sharedContainerURL(for: kind).appendingPathComponent(fileName)
  }

  private func sharedContainerURL(for kind: SharedContainerKind) throws -> URL {
    let containerURL = try baseDirectoryURL(for: kind)
    try FileManager.default.createDirectory(at: containerURL, withIntermediateDirectories: true)
    return containerURL
  }

  func getSharedCacheDirectory() throws -> URL {
    let fileManager = FileManager.default

    guard
      let groupURL = fileManager.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier)
    else {
      throw PassError.executionFailed("Could not load AppGroup")
    }

    let cacheURL = groupURL.appendingPathComponent("Library/Caches", isDirectory: true)
    let myDirURL = cacheURL.appendingPathComponent(sharedContainerDirectoryName, isDirectory: true)

    if !fileManager.fileExists(atPath: myDirURL.path) {
      do {
        try fileManager.createDirectory(
          at: myDirURL, withIntermediateDirectories: true, attributes: nil)
      } catch {
        throw PassError.executionFailed("Could not create shared cache dir: \(error)")
      }
    }

    return myDirURL
  }

  private func baseDirectoryURL(for kind: SharedContainerKind) throws -> URL {
    return try getSharedCacheDirectory()
  }

  private func resolvedStoreConfiguration() throws -> StoreConfiguration {
    guard let storedSelection = storedStoreSelection() else {
      return StoreConfiguration(
        url: URL(fileURLWithPath: resolvedDefaultStorePath(), isDirectory: true),
        requiresSecurityScope: false
      )
    }

    // When not sandboxed, we can just use the path directly without security-scoped bookmarks
    let url = URL(fileURLWithPath: storedSelection.path, isDirectory: true)
    return StoreConfiguration(
      url: url,
      requiresSecurityScope: false
    )
  }

  private func withStoreAccess<T>(_ configuration: StoreConfiguration, action: () throws -> T)
    throws -> T
  {
    let didStartSecurityScope =
      configuration.requiresSecurityScope
      ? configuration.url.startAccessingSecurityScopedResource() : false
    defer {
      if didStartSecurityScope {
        configuration.url.stopAccessingSecurityScopedResource()
      }
    }

    return try action()
  }

  private func storeInventory(in configuration: StoreConfiguration) throws -> StoreInventory {
    let fileManager = FileManager.default
    var isDirectory: ObjCBool = false

    guard fileManager.fileExists(atPath: configuration.url.path, isDirectory: &isDirectory) else {
      throw PassError.executionFailed(
        "Password store not found or is not accessible at \(configuration.url.path).")
    }

    guard isDirectory.boolValue else {
      throw PassError.executionFailed("Password store path is not a directory.")
    }

    let resourceKeys: [URLResourceKey] = [.isRegularFileKey, .contentModificationDateKey]
    let options: FileManager.DirectoryEnumerationOptions = [.skipsHiddenFiles]

    guard
      let enumerator = fileManager.enumerator(
        at: configuration.url,
        includingPropertiesForKeys: resourceKeys,
        options: options,
        errorHandler: { url, error in
          NSLog("Failed to inspect %@: %@", url.path, error.localizedDescription)
          return true
        }
      )
    else {
      throw PassError.executionFailed("Unable to read the password store.")
    }

    var entries: [StoreInventoryEntry] = []
    var latestModificationTime: TimeInterval = 0

    for case let fileURL as URL in enumerator {
      guard fileURL.pathExtension == "gpg" else {
        continue
      }

      var modificationTime: TimeInterval = 0

      do {
        let values = try fileURL.resourceValues(forKeys: Set(resourceKeys))
        guard values.isRegularFile == true else {
          continue
        }

        if let modificationDate = values.contentModificationDate {
          modificationTime = modificationDate.timeIntervalSince1970
          latestModificationTime = max(
            latestModificationTime, modificationDate.timeIntervalSince1970)
        }
      } catch {
        NSLog("Failed to read metadata for %@: %@", fileURL.path, error.localizedDescription)
        continue
      }

      let relativePath =
        fileURL
        .deletingPathExtension()
        .path
        .replacingOccurrences(of: configuration.url.path + "/", with: "")

      entries.append(StoreInventoryEntry(path: relativePath, modificationTime: modificationTime))
    }

    entries.sort { $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending }
    return StoreInventory(entries: entries, latestModificationTime: latestModificationTime)
  }

  private func resolvedOTPDetails(for entryName: String, configuration: StoreConfiguration) throws
    -> OTPDetails
  {
    let code = try runPass(arguments: ["otp", "code", entryName], configuration: configuration)
    let uriOutput = try? runPass(
      arguments: ["otp", "uri", entryName], configuration: configuration)
    let metadata = otpMetadata(from: uriOutput)

    return OTPDetails(
      code: code,
      type: metadata.type,
      period: metadata.period
    )
  }

  private func otpMetadata(from rawURI: String?) -> (type: String?, period: Int?) {
    guard let trimmedURI = rawURI?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmedURI.isEmpty,
      let components = URLComponents(string: trimmedURI)
    else {
      return (nil, nil)
    }

    let otpType = components.host?.lowercased()
    if otpType == "totp" {
      let periodValue = components.queryItems?.first(where: { $0.name == "period" })?.value
      let period = periodValue.flatMap(Int.init) ?? 30
      return (otpType, period)
    }

    return (otpType, nil)
  }

  private func urlIndexEntry(for entry: StoreInventoryEntry, from output: String)
    -> URLIndexCacheEntry?
  {
    let lines = output.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    guard lines.count > 0 else {
      return nil
    }

    var urls: Set<String> = []
    var hosts: Set<String> = []

    for line in lines.dropFirst() {
      guard let separatorIndex = line.firstIndex(of: ":") else {
        continue
      }

      let label = String(line[..<separatorIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
      let value = String(line[line.index(after: separatorIndex)...]).trimmingCharacters(
        in: .whitespacesAndNewlines)
      guard !value.isEmpty, ["url", "website", "site"].contains(where: label.hasPrefix) else {
        continue
      }

      if let normalizedURL = normalizedURL(from: value) {
        urls.insert(normalizedURL.absoluteString)
        if let host = normalizedHost(from: normalizedURL.host) {
          hosts.insert(host)
        }
        continue
      }

      if let host = normalizedHost(from: value) {
        hosts.insert(host)
      }
    }

    return URLIndexCacheEntry(
      hosts: hosts.sorted(),
      urls: urls.sorted(),
      modificationTime: entry.modificationTime
    )
  }

  private func normalizedURL(from rawValue: String?) -> URL? {
    guard let trimmedValue = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmedValue.isEmpty
    else {
      return nil
    }

    if let directURL = URL(string: trimmedValue), directURL.host != nil {
      return directURL
    }

    if !trimmedValue.contains("://"),
      let httpsURL = URL(string: "https://\(trimmedValue)"),
      httpsURL.host != nil
    {
      return httpsURL
    }

    return nil
  }

  private func normalizedEntryName(from rawEntryName: String?) throws -> String {
    guard let trimmedEntryName = rawEntryName?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmedEntryName.isEmpty
    else {
      throw PassError.missingEntryName
    }

    return trimmedEntryName
  }

  private func runPass(arguments: [String], configuration: StoreConfiguration) throws -> String {
    let executablePath = try resolvedPassExecutablePath()
    let process = Process()
    let outputPipe = Pipe()
    let errorPipe = Pipe()

    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = arguments
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = executionPathEnvironment()
    environment["HOME"] = currentUserHomeDirectoryPath()
    environment["PASSWORD_STORE_DIR"] = configuration.url.path
    environment["LANG"] = environment["LANG"] ?? "en_US.UTF-8"
    process.environment = environment

    do {
      try process.run()
    } catch {
      throw PassError.executionFailed("Failed to run 'pass': \(error.localizedDescription)")
    }

    process.waitUntilExit()

    let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
    let output = String(data: outputData, encoding: .utf8) ?? ""
    let errorOutput =
      String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""

    guard process.terminationStatus == 0 else {
      let message =
        errorOutput.isEmpty
        ? "'pass' exited with status \(process.terminationStatus)." : errorOutput
      throw PassError.executionFailed(message)
    }

    return output
  }

  private func updatePassEntry(
    entryName: String, content: String, configuration: StoreConfiguration
  ) throws {
    let executablePath = try resolvedPassExecutablePath()
    let process = Process()
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    let errorPipe = Pipe()

    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = ["insert", "-m", "-f", entryName]
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = executionPathEnvironment()
    environment["HOME"] = currentUserHomeDirectoryPath()
    environment["PASSWORD_STORE_DIR"] = configuration.url.path
    environment["LANG"] = environment["LANG"] ?? "en_US.UTF-8"
    process.environment = environment

    do {
      try process.run()

      // Write the content to stdin
      let contentData = content.data(using: .utf8) ?? Data()
      inputPipe.fileHandleForWriting.write(contentData)
      try inputPipe.fileHandleForWriting.close()
    } catch {
      throw PassError.executionFailed("Failed to run 'pass insert': \(error.localizedDescription)")
    }

    process.waitUntilExit()

    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
    let errorOutput =
      String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""

    guard process.terminationStatus == 0 else {
      let message =
        errorOutput.isEmpty
        ? "'pass insert' exited with status \(process.terminationStatus)." : errorOutput
      throw PassError.executionFailed(message)
    }
  }

  private func deletePassEntry(entryName: String, configuration: StoreConfiguration) throws {
    let executablePath = try resolvedPassExecutablePath()
    let process = Process()
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    let errorPipe = Pipe()

    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = ["remove", "-f", entryName]
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = executionPathEnvironment()
    environment["HOME"] = currentUserHomeDirectoryPath()
    environment["PASSWORD_STORE_DIR"] = configuration.url.path
    environment["LANG"] = environment["LANG"] ?? "en_US.UTF-8"
    process.environment = environment

    do {
      try process.run()
    } catch {
      throw PassError.executionFailed("Failed to run 'pass remove': \(error.localizedDescription)")
    }

    process.waitUntilExit()

    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
    let errorOutput =
      String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""

    guard process.terminationStatus == 0 else {
      let message =
        errorOutput.isEmpty
        ? "'pass remove' exited with status \(process.terminationStatus)." : errorOutput
      throw PassError.executionFailed(message)
    }
  }

  private func gitPull(configuration: StoreConfiguration) throws {
    let executablePath = try resolvedPassExecutablePath()
    let process = Process()
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    let errorPipe = Pipe()

    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = ["git", "pull"]
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = executionPathEnvironment()
    environment["HOME"] = currentUserHomeDirectoryPath()
    environment["PASSWORD_STORE_DIR"] = configuration.url.path
    environment["LANG"] = environment["LANG"] ?? "en_US.UTF-8"
    process.environment = environment

    do {
      try process.run()
    } catch {
      throw PassError.executionFailed(
        "Failed to run 'pass git pull': \(error.localizedDescription)")
    }

    process.waitUntilExit()

    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
    let errorOutput =
      String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""

    guard process.terminationStatus == 0 else {
      let message =
        errorOutput.isEmpty
        ? "'pass git pull' exited with status \(process.terminationStatus)." : errorOutput
      throw PassError.executionFailed(message)
    }
  }

  private func gitPush(configuration: StoreConfiguration) throws {
    let executablePath = try resolvedPassExecutablePath()
    let process = Process()
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    let errorPipe = Pipe()

    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = ["git", "push"]
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = executionPathEnvironment()
    environment["HOME"] = currentUserHomeDirectoryPath()
    environment["PASSWORD_STORE_DIR"] = configuration.url.path
    environment["LANG"] = environment["LANG"] ?? "en_US.UTF-8"
    process.environment = environment

    do {
      try process.run()
    } catch {
      throw PassError.executionFailed(
        "Failed to run 'pass git push': \(error.localizedDescription)")
    }

    process.waitUntilExit()

    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
    let errorOutput =
      String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""

    guard process.terminationStatus == 0 else {
      let message =
        errorOutput.isEmpty
        ? "'pass git push' exited with status \(process.terminationStatus)." : errorOutput
      throw PassError.executionFailed(message)
    }
  }

  private func resolvedPassExecutablePath() throws -> String {
    let fileManager = FileManager.default

    for candidate in passExecutableCandidates {
      var isDirectory: ObjCBool = false
      if fileManager.fileExists(atPath: candidate, isDirectory: &isDirectory),
        !isDirectory.boolValue
      {
        return candidate
      }
    }

    if let discoveredPath = try discoveredPassExecutablePath() {
      return discoveredPath
    }

    throw PassError.passExecutableNotFound
  }

  private func discoveredPassExecutablePath() throws -> String? {
    let process = Process()
    let outputPipe = Pipe()
    let errorPipe = Pipe()

    process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
    process.arguments = ["pass"]
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = executionPathEnvironment()
    process.environment = environment

    do {
      try process.run()
    } catch {
      return nil
    }

    process.waitUntilExit()

    guard process.terminationStatus == 0 else {
      return nil
    }

    let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
    let output =
      String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? ""

    guard !output.isEmpty else {
      return nil
    }

    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: output, isDirectory: &isDirectory),
      !isDirectory.boolValue
    else {
      return nil
    }

    return output
  }

  private func executionPathEnvironment() -> String {
    [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].joined(separator: ":")
  }

  private func resolvedDefaultStorePath() -> String {
    let rawPath = defaultStorePath

    guard rawPath.hasPrefix("~/") || rawPath == "~" else {
      return NSString(string: rawPath).standardizingPath
    }

    let suffix = rawPath == "~" ? "" : String(rawPath.dropFirst(2))
    let homePath = currentUserHomeDirectoryPath()
    return NSString(string: homePath).appendingPathComponent(suffix)
  }

  private func currentUserHomeDirectoryPath() -> String {
    guard let entry = getpwuid(getuid())?.pointee,
      let directory = entry.pw_dir
    else {
      return NSHomeDirectory()
    }

    return String(cString: directory)
  }
}
