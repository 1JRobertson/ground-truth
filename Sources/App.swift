import AppKit
import WebKit

private enum LocalPage {
    static let scheme = "ground-truth"
    static let host = "dashboard"
    static let url = URL(string: "\(scheme)://\(host)/index.html")!
    static let assets = [
        "index.html": "text/html", "app.js": "text/javascript", "theme.js": "text/javascript",
        "chart-axis.js": "text/javascript",
        "styles.css": "text/css", "theme.css": "text/css", "setup.css": "text/css",
    ]

    static func filename(_ url: URL?) -> String? {
        guard let url, url.scheme == scheme, url.host == host, url.port == nil,
              url.user == nil, url.password == nil, url.query == nil else { return nil }
        let name = String(url.path.dropFirst())
        return assets[name] == nil ? nil : name
    }

    static func isDashboard(_ url: URL?) -> Bool { filename(url) == "index.html" }
}

private final class WebAssets: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard task.request.httpMethod == "GET", let url = task.request.url, let name = LocalPage.filename(url),
              let type = LocalPage.assets[name],
              let location = Bundle.main.resourceURL?.appendingPathComponent("Web").appendingPathComponent(name),
              let data = try? Data(contentsOf: location) else {
            task.didFailWithError(URLError(.resourceUnavailable))
            return
        }
        task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

private struct ViewState: Encodable {
    let connected: Bool
    let mode: String
    let data: Dashboard?
    let message: String?
    let syncedAt: Date?
}

@main
@MainActor
final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    #if GROUND_TRUTH_WEB_SMOKE
    private let service = "app.groundtruth.test.\(UUID())"
    #else
    private let service = "app.groundtruth.mac.garmin-personal-api"
    #endif
    private lazy var keychain = Keychain(service: service)
    private lazy var store = SnapshotStore(
        directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Ground Truth", isDirectory: true)
    )
    private let garmin = GarminClient()
    private var window: NSWindow!
    private var webView: WKWebView!
    private var didRestore = false
    private var connected = false
    private var needsNewKey = false
    private var sample: Dashboard?
    private var saved: SavedDashboard?
    private var working = false
    private var message: String?

    static func main() {
        let application = NSApplication.shared
        let delegate = App()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
        withExtendedLifetime(delegate) {}
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenu()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(WebAssets(), forURLScheme: LocalPage.scheme)
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "groundTruth")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsLinkPreview = false
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1170, height: 780),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Ground Truth"
        window.minSize = NSSize(width: 640, height: 525)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: LocalPage.url))
        #if GROUND_TRUTH_WEB_SMOKE
        runWebSmoke(webView)
        #endif
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.targetFrame?.isMainFrame == true && LocalPage.isDashboard(action.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.isForMainFrame && LocalPage.isDashboard(response.response.url) ? .allow : .cancel)
    }

    func userContentController(_ controller: WKUserContentController, didReceive event: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard event.name == "groundTruth", event.webView === webView, event.frameInfo.isMainFrame,
              LocalPage.isDashboard(event.frameInfo.request.url), LocalPage.isDashboard(webView.url),
              let action = event.body as? String else {
            replyHandler(nil, "Ground Truth could not verify this page.")
            return
        }
        Task { @MainActor in
            do { replyHandler(try await handle(action), nil) }
            catch let error as GroundTruthError { replyHandler(nil, error.errorDescription) }
            catch { replyHandler(nil, "Ground Truth could not complete this action.") }
        }
    }

    private func handle(_ action: String) async throws -> Any {
        if !didRestore {
            didRestore = true
            do {
                if let connection = try keychain.read() {
                    connected = true
                    saved = store.read(connectionID: connection.id)
                }
            } catch {
                message = GroundTruthError.keychainUnavailable.errorDescription
            }
        }
        switch action {
        case "state": break
        case "demo":
            if !connected { sample = demoDashboard() }
            message = nil
        case "openGarmin":
            NSWorkspace.shared.open(GarminClient.settingsURL)
        case "connect", "sync", "disconnect":
            guard !working else { throw GroundTruthError.alreadyWorking }
            working = true
            defer { working = false }
            switch action {
            case "connect":
                if let key = await requestKey() {
                    try await sync(connection: .init(id: UUID(), key: key), replace: true)
                }
            case "sync":
                guard let connection = try keychain.read() else {
                    connected = false
                    saved = nil
                    message = GroundTruthError.rejectedKey.errorDescription
                    break
                }
                do { try await sync(connection: connection, replace: false) }
                catch GroundTruthError.rejectedKey {
                    needsNewKey = true
                    message = GroundTruthError.rejectedKey.errorDescription
                }
            default:
                if await confirmDisconnect() {
                    try store.remove()
                    saved = nil
                    try keychain.remove()
                    connected = false
                    needsNewKey = false
                    sample = nil
                    message = "Disconnected from Garmin."
                }
            }
        default:
            throw URLError(.unsupportedURL)
        }
        let data = saved?.data ?? sample
        let mode = saved != nil ? "garmin" : sample != nil ? "demo" : "setup"
        let state = ViewState(connected: connected, mode: mode, data: data,
                              message: message ?? (needsNewKey ? GroundTruthError.rejectedKey.errorDescription : nil),
                              syncedAt: saved?.syncedAt)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try JSONSerialization.jsonObject(with: encoder.encode(state))
    }

    private func sync(connection: GarminConnection, replace: Bool) async throws {
        let result = try await garmin.sync(key: connection.key)
        let next = SavedDashboard(connectionID: connection.id, syncedAt: .now, data: result)
        if replace {
            let previousConnection = try keychain.read()
            try keychain.write(connection)
            do { try store.write(next) }
            catch {
                if let previousConnection { try? keychain.write(previousConnection) }
                else { try? keychain.remove() }
                throw error
            }
        } else {
            try store.write(next)
        }
        connected = true
        needsNewKey = false
        sample = nil
        saved = next
        message = result.coverage.isEmpty ? "Connected. Garmin returned no records for the last 30 days." : nil
    }

    private func requestKey() async -> String? {
        let dialog = NSAlert()
        dialog.messageText = "Connect Garmin"
        dialog.informativeText = "Paste your Personal API key from Garmin Connect."
        dialog.addButton(withTitle: "Connect")
        dialog.addButton(withTitle: "Cancel")
        let input = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        input.placeholderString = "Personal API key"
        input.setAccessibilityLabel("Garmin Personal API key")
        dialog.accessoryView = input
        dialog.window.initialFirstResponder = input
        let result = await dialog.beginSheetModal(for: window)
        defer { input.stringValue = "" }
        guard result == .alertFirstButtonReturn else { return nil }
        return input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func confirmDisconnect() async -> Bool {
        let dialog = NSAlert()
        dialog.messageText = "Disconnect Garmin?"
        dialog.informativeText = "This Mac will remove the saved key and downloaded Garmin data. You can revoke the key in Garmin Connect."
        dialog.addButton(withTitle: "Cancel")
        dialog.addButton(withTitle: "Disconnect").hasDestructiveAction = true
        let result = await dialog.beginSheetModal(for: window)
        return result == .alertSecondButtonReturn
    }

    private func configureMenu() {
        let menu = NSMenu()
        let app = NSMenuItem()
        app.submenu = NSMenu(title: "Ground Truth")
        app.submenu?.addItem(withTitle: "Quit Ground Truth", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(app)
        let edit = NSMenuItem()
        edit.submenu = NSMenu(title: "Edit")
        edit.submenu?.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.submenu?.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.submenu?.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.submenu?.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        menu.addItem(edit)
        NSApplication.shared.mainMenu = menu
    }
}
