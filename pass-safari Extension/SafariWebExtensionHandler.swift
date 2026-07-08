//
//  SafariWebExtensionHandler.swift
//  pass-safari Extension
//
//  Created by Mario Zimmermann on 15.06.26.
//

import AppKit
import Darwin
import SafariServices
import os.log

private let appGroupIdentifier = "group.de.zisoft.pass-safari"
private let defaultStorePath = "~/.password-store"
private let sharedContainerDirectoryName = "pass-safari"
private let passRequestFileNamePrefix = "PassRequest-"
private let passResponseFileNamePrefix = "PassResponse-"
private let urlIndexCacheFileName = "URLIndexCache.json"
private let urlIndexRefreshLockFileName = "URLIndexRefresh.lock"
private let runPassURLHost = "run-pass"
private let refreshURLIndexURLHost = "refresh-url-index"

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

  private struct StoreConfiguration {
    let url: URL
    let displayPath: String
    let usingDefaultStore: Bool
    let requiresSecurityScope: Bool
  }

  private struct StoreSelectionEvent {
    let requestID: String
    let status: StoreSelectionEventStatus
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
    let storePath: String
    let entryCount: Int
    let latestStoreModificationTime: TimeInterval
    let generatedAt: TimeInterval
    let entries: [String: URLIndexCacheEntry]

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

  private struct URLIndexMatchCandidate {
    let entry: String
    let score: Int
  }

  private struct PassResponse {
    let requestID: String
    let ok: Bool
    let output: String?
    let stderr: String?
    let otpCode: String?
    let otpType: String?
    let otpPeriod: Int?
    let errorMessage: String?
  }

  private struct EntryDetails {
    let password: String
    let username: String?
    let url: String?
    let fields: [[String: String]]
    let notes: String?
  }

  private enum StoreError: LocalizedError {
    case chooserUnavailable
    case chooserTimedOut

    var errorDescription: String? {
      switch self {
      case .chooserUnavailable:
        return "Unable to open the password-store chooser app."
      case .chooserTimedOut:
        return "No folder selection was received from the companion app."
      }
    }
  }

  private enum StoreSelectionEventStatus: String {
    case selected
    case cancelled
  }

  private enum PassBridgeError: LocalizedError {
    case companionUnavailable
    case responseTimedOut
    case invalidResponse

    var errorDescription: String? {
      switch self {
      case .companionUnavailable:
        return "Unable to open the companion app to read pass entries."
      case .responseTimedOut:
        return "The companion app did not return a pass entry in time."
      case .invalidResponse:
        return "The companion app returned an invalid pass response."
      }
    }
  }

  private enum PassError: LocalizedError {
    case missingEntryName
    case missingCopyText
    case passExecutableNotFound
    case executionFailed(String)
    case invalidOutput

    var errorDescription: String? {
      switch self {
      case .missingEntryName:
        return "No pass entry was specified."
      case .missingCopyText:
        return "Nothing to copy."
      case .passExecutableNotFound:
        return "Unable to find the 'pass' executable."
      case .executionFailed(let message):
        return message
      case .invalidOutput:
        return "The selected pass entry has no readable content."
      }
    }
  }

  func beginRequest(with context: NSExtensionContext) {
    let request = context.inputItems.first as? NSExtensionItem

    let profile: UUID?
    if #available(iOS 17.0, macOS 14.0, *) {
      profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
    } else {
      profile = request?.userInfo?["profile"] as? UUID
    }

    let message: Any?
    if #available(iOS 15.0, macOS 11.0, *) {
      message = request?.userInfo?[SFExtensionMessageKey]
    } else {
      message = request?.userInfo?["message"]
    }

    os_log(
      .default, "Received message from browser.runtime.sendNativeMessage: %@ (profile: %@)",
      String(describing: message), profile?.uuidString ?? "none")

    let response = NSExtensionItem()
    let responseBody = handleMessage(message)

    if #available(iOS 15.0, macOS 11.0, *) {
      response.userInfo = [SFExtensionMessageKey: responseBody]
    } else {
      response.userInfo = ["message": responseBody]
    }

    context.completeRequest(returningItems: [response], completionHandler: nil)
  }

  private func handleMessage(_ message: Any?) -> [String: Any] {
    guard let payload = message as? [String: Any] else {
      return [
        "ok": false,
        "error": "Invalid request payload.",
      ]
    }

    switch payload["command"] as? String {
    case "listEntries":
      return listEntries(pageURL: payload["pageURL"] as? String)
    case "getEntryDetails":
      return getEntryDetails(entryName: payload["entry"] as? String)
    case "getEntryOTP":
      return getEntryOTP(entryName: payload["entry"] as? String)
    case "updateEntry":
      return updateEntry(
        entryName: payload["entry"] as? String, content: payload["content"] as? String)
    case "deleteEntry":
      return deleteEntry(entryName: payload["entry"] as? String)
    case "copyText":
      return copyText(payload["text"] as? String)
    case "syncStore":
      return syncStore()
    default:
      return [
        "ok": false,
        "error": "Unsupported command.",
      ]
    }
  }

  private func listEntries(pageURL: String?) -> [String: Any] {
    do {
      let configuration = try resolvedStoreConfiguration()
      let inventory = try withStoreAccess(configuration) {
        try storeInventory(in: configuration)
      }

      let cache = (try? readURLIndexCache()) ?? URLIndexCache()
      let usableCache = cache.storePath == configuration.url.path ? cache : nil
      let cacheNeedsRefresh = urlIndexNeedsRefresh(
        configuration: configuration, inventory: inventory, cache: usableCache)
      let urlIndexRefreshing = urlIndexRefreshLockIsActive()

      if cacheNeedsRefresh && !urlIndexRefreshing {
        try? launchContainingAppForURLIndexRefresh()
      }

      let matchCandidates = rankedURLIndexMatches(
        for: pageURL, inventory: inventory, cache: usableCache)
      let suggestions = matchCandidates.prefix(5).map { $0.entry }

      var response = response(for: configuration)
      response["ok"] = true
      response["entries"] = inventory.entries.map { $0.path }
      response["urlIndexReady"] = usableCache != nil
      response["urlIndexRefreshing"] = cacheNeedsRefresh || urlIndexRefreshing
      if let shortcutMatchEntry = shortcutMatchEntry(from: matchCandidates) {
        response["shortcutMatchEntry"] = shortcutMatchEntry
      }
      if !suggestions.isEmpty {
        response["suggestedEntries"] = suggestions
      }

      return response
    } catch {
      var response = errorResponse(for: error)
      response["entries"] = []
      return response
    }
  }

  private func getEntryDetails(entryName: String?) -> [String: Any] {
    do {
      let normalizedEntryName = try normalizedEntryName(from: entryName)
      let configuration = try resolvedStoreConfiguration()
      let passResponse = try requestPassDetails(entryName: normalizedEntryName)
      let details = try parseEntryDetails(from: passResponse.output ?? "")

      var response = response(for: configuration)
      response["ok"] = true
      response["entry"] = normalizedEntryName
      response["password"] = details.password
      response["output"] = passResponse.output
      if let username = details.username {
        response["username"] = username
      }
      if let url = details.url {
        response["url"] = url
      }
      if let otpCode = passResponse.otpCode, !otpCode.isEmpty {
        response["otp"] = otpCode
      }
      if let otpType = passResponse.otpType, !otpType.isEmpty {
        response["otpType"] = otpType
      }
      if let otpPeriod = passResponse.otpPeriod, otpPeriod > 0 {
        response["otpPeriod"] = otpPeriod
      }
      if !details.fields.isEmpty {
        response["fields"] = details.fields
      }
      if let notes = details.notes, !notes.isEmpty {
        response["notes"] = notes
      }
      return response
    } catch {
      return errorResponse(for: error)
    }
  }

  private func getEntryOTP(entryName: String?) -> [String: Any] {
    do {
      let normalizedEntryName = try normalizedEntryName(from: entryName)
      let configuration = try resolvedStoreConfiguration()
      let passResponse = try requestPassResponse(
        command: "getEntryOTP", entryName: normalizedEntryName)

      var response = response(for: configuration)
      response["ok"] = true
      response["entry"] = normalizedEntryName
      response["otp"] = passResponse.otpCode ?? ""
      if let otpType = passResponse.otpType, !otpType.isEmpty {
        response["otpType"] = otpType
      }
      if let otpPeriod = passResponse.otpPeriod, otpPeriod > 0 {
        response["otpPeriod"] = otpPeriod
      }
      return response
    } catch {
      return errorResponse(for: error)
    }
  }

  private func updateEntry(entryName: String?, content: String?) -> [String: Any] {
    do {
      let normalizedEntryName = try normalizedEntryName(from: entryName)

      guard let trimmedContent = content,
        !trimmedContent.isEmpty
      else {
        throw PassError.executionFailed("Entry content cannot be empty.")
      }

      let configuration = try resolvedStoreConfiguration()
      let passResponse = try requestPassResponse(
        command: "updateEntry", entryName: normalizedEntryName, content: trimmedContent)

      guard passResponse.ok else {
        throw PassError.executionFailed(passResponse.errorMessage ?? "Unable to update entry.")
      }

      var response = response(for: configuration)
      response["ok"] = true
      response["entry"] = normalizedEntryName
      return response
    } catch {
      return errorResponse(for: error)
    }
  }

  private func deleteEntry(entryName: String?) -> [String: Any] {
    do {
      let normalizedEntryName = try normalizedEntryName(from: entryName)

      let configuration = try resolvedStoreConfiguration()
      let passResponse = try requestPassResponse(
        command: "deleteEntry", entryName: normalizedEntryName)

      guard passResponse.ok else {
        throw PassError.executionFailed(passResponse.errorMessage ?? "Unable to delete entry.")
      }

      var response = response(for: configuration)
      response["ok"] = true
      return response
    } catch {
      return errorResponse(for: error)
    }
  }

  private func copyText(_ text: String?) -> [String: Any] {
    let trimmedText = text
    guard let copyText = trimmedText, !copyText.isEmpty else {
      return errorResponse(for: PassError.missingCopyText)
    }

    do {
      try runOnMainThread {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(copyText, forType: .string)
      }

      return ["ok": true]
    } catch {
      return errorResponse(for: error)
    }
  }

  private func syncStore() -> [String: Any] {
    do {
      let configuration = try resolvedStoreConfiguration()
      let passResponse = try requestPassResponse(command: "syncStore", entryName: "dummy")

      guard passResponse.ok else {
        throw PassError.executionFailed(passResponse.errorMessage ?? "Unable to sync.")
      }

      var response = response(for: configuration)
      response["ok"] = true
      if let output = passResponse.output {
        response["output"] = output
      }
      if let stderr = passResponse.stderr {
        response["stderr"] = stderr
      }
      return response
    } catch {
      return errorResponse(for: error)
    }
  }

  private func response(for configuration: StoreConfiguration) -> [String: Any] {
    [
      "ok": true
    ]
  }

  private func errorResponse(for error: Error) -> [String: Any] {
    let response: [String: Any] = [
      "ok": false,
      "error": error.localizedDescription,
    ]

    return response
  }

  private func resolvedStoreConfiguration() throws -> StoreConfiguration {
    let path = resolvedDefaultStorePath()
    return StoreConfiguration(
      url: URL(fileURLWithPath: path, isDirectory: true),
      displayPath: path,
      usingDefaultStore: true,
      requiresSecurityScope: false
    )
  }

  private func enumeratedEntries(in configuration: StoreConfiguration) throws
    -> [StoreInventoryEntry]
  {
    try storeInventory(in: configuration).entries
  }

  private func storeInventory(in configuration: StoreConfiguration) throws -> StoreInventory {
    let fileManager = FileManager.default
    var isDirectory: ObjCBool = false

    guard fileManager.fileExists(atPath: configuration.url.path, isDirectory: &isDirectory) else {
      throw PassError.executionFailed(
        "Password store not found or is not accessible at \(configuration.displayPath).")
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
          os_log(.error, "Failed to inspect %@: %@", url.path, error.localizedDescription)
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
        os_log(
          .error, "Failed to read metadata for %@: %@", fileURL.path, error.localizedDescription)
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

  private func normalizedEntryName(from rawEntryName: String?) throws -> String {
    guard let trimmedEntryName = rawEntryName?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmedEntryName.isEmpty
    else {
      throw PassError.missingEntryName
    }

    return trimmedEntryName
  }

  private func parseEntryDetails(from output: String) throws -> EntryDetails {
    let normalizedOutput = output.replacingOccurrences(of: "\r\n", with: "\n")
    let lines = normalizedOutput.components(separatedBy: "\n")

    guard let firstLine = lines.first else {
      throw PassError.invalidOutput
    }

    var username: String?
    var url: String?
    var fields: [[String: String]] = []
    var notes: [String] = []

    for line in lines.dropFirst() {
      if line.isEmpty {
        notes.append("")
        continue
      }

      guard let separatorIndex = line.firstIndex(of: ":") else {
        notes.append(line)
        continue
      }

      let label = String(line[..<separatorIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
      let value = String(line[line.index(after: separatorIndex)...]).trimmingCharacters(
        in: .whitespacesAndNewlines)

      guard !label.isEmpty else {
        notes.append(line)
        continue
      }

      switch label.lowercased() {
      case "login", "username", "user":
        if username == nil, !value.isEmpty {
          username = value
        }
      case "url", "website", "site":
        if url == nil, !value.isEmpty {
          url = value
        }
      default:
        break
      }

      if !value.isEmpty,
        !["login", "username", "user", "url", "website", "site"].contains(label.lowercased())
      {
        fields.append([
          "label": label,
          "value": value,
        ])
      }
    }

    let notesText =
      notes.isEmpty
      ? nil : notes.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)

    return EntryDetails(
      password: firstLine,
      username: username,
      url: url,
      fields: fields,
      notes: notesText?.isEmpty == false ? notesText : nil
    )
  }

  private func requestPassDetails(entryName: String) throws -> PassResponse {
    try requestPassResponse(command: "getEntryDetails", entryName: entryName)
  }

  private func requestPassResponse(command: String, entryName: String, content: String? = nil)
    throws -> PassResponse
  {
    let requestID = UUID().uuidString
    try removePassResponseFile(requestID: requestID)
    try writePassRequest(
      requestID: requestID, command: command, entryName: entryName, content: content)
    try launchContainingAppForPassRequest(requestID: requestID)

    let response = try waitForPassResponse(requestID: requestID)
    guard response.ok else {
      throw PassError.executionFailed(
        response.errorMessage ?? "Unable to load the selected pass entry.")
    }

    return response
  }

  private func waitForPassResponse(requestID: String) throws -> PassResponse {
    let timeoutAt = Date().addingTimeInterval(120)
    NSLog("[Extension] Waiting for pass response: %@", requestID)

    while Date() < timeoutAt {
      if let response = try? readPassResponseFromFile(requestID: requestID),
        response.requestID == requestID
      {
        NSLog("[Extension] Received pass response")
        try? removePassResponseFile(requestID: requestID)
        return response
      }

      Thread.sleep(forTimeInterval: 0.25)
    }

    NSLog("[Extension] Pass response timeout")
    throw PassBridgeError.responseTimedOut
  }

  private func writePassRequest(
    requestID: String, command: String, entryName: String, content: String? = nil
  ) throws {
    var payload: [String: Any] = [
      "command": command,
      "entry": entryName,
    ]

    if let content = content {
      payload["content"] = content
    }

    let plistData = try PropertyListSerialization.data(
      fromPropertyList: payload, format: .binary, options: 0)
    let fileURL = try passRequestFileURL(requestID: requestID)
    NSLog("[Extension] Writing pass request to: %@", fileURL.path)
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try plistData.write(to: fileURL, options: .atomic)
    NSLog("[Extension] Pass request written successfully")
  }

  private func readPassResponseFromFile(requestID: String) throws -> PassResponse {
    let data = try Data(contentsOf: passResponseFileURL(requestID: requestID))
    let propertyList = try PropertyListSerialization.propertyList(from: data, format: nil)

    guard let payload = propertyList as? [String: Any],
      let payloadRequestID = payload["requestId"] as? String,
      let ok = payload["ok"] as? Bool
    else {
      throw PassBridgeError.invalidResponse
    }

    return PassResponse(
      requestID: payloadRequestID,
      ok: ok,
      output: payload["output"] as? String,
      stderr: payload["stderr"] as? String,
      otpCode: payload["otp"] as? String,
      otpType: payload["otpType"] as? String,
      otpPeriod: payload["otpPeriod"] as? Int,
      errorMessage: payload["error"] as? String
    )
  }

  private func removePassResponseFile(requestID: String) throws {
    let fileURL = try passResponseFileURL(requestID: requestID)
    if FileManager.default.fileExists(atPath: fileURL.path) {
      try FileManager.default.removeItem(at: fileURL)
    }
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

  private func launchContainingAppForPassRequest(requestID: String) throws {
    NSLog("[Extension] Launching app for pass request: %@", requestID)
    try launchContainingApp(
      urlHost: runPassURLHost, requestID: requestID,
      unavailableError: PassBridgeError.companionUnavailable)
  }

  private func launchContainingAppForURLIndexRefresh() throws {
    try launchContainingApp(
      urlHost: refreshURLIndexURLHost, requestID: nil,
      unavailableError: PassBridgeError.companionUnavailable)
  }

  private func launchContainingApp(urlHost: String, requestID: String?, unavailableError: Error)
    throws
  {
    var components = URLComponents()
    components.scheme = "pass-safari"
    components.host = urlHost
    components.queryItems = requestID.map { [URLQueryItem(name: "requestId", value: $0)] }

    guard let appURL = components.url else {
      throw unavailableError
    }

    let didOpen = try runOnMainThread {
      NSWorkspace.shared.open(appURL)
    }

    guard didOpen else {
      throw unavailableError
    }
  }

  private func rankedURLIndexMatches(
    for pageURL: String?, inventory: StoreInventory, cache: URLIndexCache?
  ) -> [URLIndexMatchCandidate] {
    guard let cache,
      let normalizedPageURL = normalizedURL(from: pageURL)
    else {
      return []
    }

    let availableEntries = Set(inventory.entries)
    let matches = cache.entries.compactMap { item -> URLIndexMatchCandidate? in
      let (entryName, entryCache) = item
      guard availableEntries.contains(where: { $0.path.lowercased() == entryName.lowercased() })
      else {
        return nil
      }

      let score = score(entryCache: entryCache, pageURL: normalizedPageURL)
      return score > 0 ? URLIndexMatchCandidate(entry: entryName, score: score) : nil
    }
    .sorted { left, right in
      if left.score != right.score {
        return left.score > right.score
      }

      if left.entry.count != right.entry.count {
        return left.entry.count < right.entry.count
      }

      return left.entry.localizedCaseInsensitiveCompare(right.entry) == .orderedAscending
    }

    return matches
  }

  private func shortcutMatchEntry(from candidates: [URLIndexMatchCandidate]) -> String? {
    let exactHostMatches = candidates.filter { $0.score >= 2200 }
    guard exactHostMatches.count == 1 else {
      return nil
    }

    return exactHostMatches.first?.entry
  }

  private func score(entryCache: URLIndexCacheEntry, pageURL: URL) -> Int {
    let normalizedPageHost = normalizedHost(from: pageURL.host) ?? ""
    guard !normalizedPageHost.isEmpty else {
      return 0
    }

    var score = 0

    for cachedHost in entryCache.hosts.compactMap({ normalizedHost(from: $0) }) {
      if cachedHost == normalizedPageHost {
        score = max(score, 2200)
      } else if hostsMatch(cachedHost, normalizedPageHost) {
        score = max(score, 1700)
      }
    }

    for rawURL in entryCache.urls {
      guard let cachedURL = normalizedURL(from: rawURL),
        let cachedHost = normalizedHost(from: cachedURL.host)
      else {
        continue
      }

      if cachedHost == normalizedPageHost {
        score = max(score, 2400)

        let cachedPath = cachedURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let pagePath = pageURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if !cachedPath.isEmpty && !pagePath.isEmpty {
          if pagePath.hasPrefix(cachedPath) || cachedPath.hasPrefix(pagePath) {
            score += 140
          }
        }
      } else if hostsMatch(cachedHost, normalizedPageHost) {
        score = max(score, 1800)
      }
    }

    return score
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

  private func normalizedHost(from rawHost: String?) -> String? {
    guard let trimmedHost = rawHost?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
      !trimmedHost.isEmpty
    else {
      return nil
    }

    return trimmedHost.hasPrefix("www.") ? String(trimmedHost.dropFirst(4)) : trimmedHost
  }

  private func hostsMatch(_ leftHost: String, _ rightHost: String) -> Bool {
    leftHost == rightHost || leftHost.hasSuffix(".\(rightHost)")
      || rightHost.hasSuffix(".\(leftHost)")
  }

  private func readURLIndexCache() throws -> URLIndexCache {
    let data = try Data(contentsOf: urlIndexCacheFileURL())
    let cache = try JSONDecoder().decode(URLIndexCache.self, from: data)
    return cache
  }

  private func urlIndexNeedsRefresh(
    configuration: StoreConfiguration, inventory: StoreInventory, cache: URLIndexCache?
  ) -> Bool {
    guard let cache else {
      return !inventory.entries.isEmpty
    }

    guard cache.storePath == configuration.url.path else {
      return true
    }

    if cache.entryCount != inventory.entries.count {
      return true
    }

    return abs(cache.latestStoreModificationTime - inventory.latestModificationTime) > 0.5
  }

  private func urlIndexRefreshLockIsActive() -> Bool {
    guard let lockFileURL = try? urlIndexRefreshLockFileURL() else {
      return false
    }

    guard FileManager.default.fileExists(atPath: lockFileURL.path) else {
      return false
    }

    if let values = try? lockFileURL.resourceValues(forKeys: [.contentModificationDateKey]),
      let modificationDate = values.contentModificationDate,
      Date().timeIntervalSince(modificationDate) > 7200
    {
      try? FileManager.default.removeItem(at: lockFileURL)
      return false
    }

    return true
  }

  private func passRequestFileURL(requestID: String) throws -> URL {
    try resolvedSharedFileURL(fileName: "\(passRequestFileNamePrefix)\(requestID).plist")
  }

  private func passResponseFileURL(requestID: String) throws -> URL {
    try resolvedSharedFileURL(fileName: "\(passResponseFileNamePrefix)\(requestID).plist")
  }

  private func urlIndexCacheFileURL() throws -> URL {
    try resolvedSharedFileURL(fileName: urlIndexCacheFileName)
  }

  private func urlIndexRefreshLockFileURL() throws -> URL {
    try resolvedSharedFileURL(fileName: urlIndexRefreshLockFileName)
  }

  private func resolvedSharedFileURL(fileName: String) throws -> URL {
    try sharedContainerURL().appendingPathComponent(fileName)
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

  private func sharedContainerURL() throws -> URL {
    let containerURL = try baseDirectoryURL()
    try FileManager.default.createDirectory(at: containerURL, withIntermediateDirectories: true)
    return containerURL
  }

  private func baseDirectoryURL() throws -> URL {
    return try getSharedCacheDirectory()
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

  private func runOnMainThread<T>(_ action: @escaping () throws -> T) throws -> T {
    if Thread.isMainThread {
      return try action()
    }

    var result: Result<T, Error>!
    DispatchQueue.main.sync {
      result = Result {
        try action()
      }
    }

    return try result.get()
  }
}
