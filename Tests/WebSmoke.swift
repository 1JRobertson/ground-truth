import AppKit
import WebKit

@MainActor
func runWebSmoke(_ web: WKWebView) {
    Task { @MainActor in
        do {
            try await waitFor(web, "document.querySelector('[data-native-action=demo]') !== null")
            if let diagnostics = ProcessInfo.processInfo.environment["GROUND_TRUTH_SMOKE_IMAGES"] {
                try await capture(web, directory: diagnostics, filename: "setup.png")
            }
            _ = try await web.evaluateJavaScript("document.querySelector('[data-native-action=demo]').click()")
            try await waitFor(web, "document.querySelector('.app-shell').dataset.mode === 'demo' && document.querySelector('#overview-steps-chart') !== null")
            try await waitFor(web, "document.querySelector('.activity-primary time')?.dateTime.endsWith('T18:15') === true")
            if let diagnostics = ProcessInfo.processInfo.environment["GROUND_TRUTH_SMOKE_IMAGES"] {
                try await capture(web, directory: diagnostics, filename: "demo.png")
            }

            let views: [(String, String)] = [
                ("recovery", "#recovery-score-chart"),
                ("sleep", "#sleep-trend-chart"),
                ("training", "#training-calendar-strip"),
                ("timeline", "#timeline-health-chart"),
            ]
            for (view, selector) in views {
                _ = try await web.evaluateJavaScript("document.querySelector('[data-view=\(view)]').click()")
                try await waitFor(web, "document.querySelector('\(selector)') !== null")
            }

            _ = try await web.evaluateJavaScript("document.querySelector('#settings-button').click()")
            try await waitFor(web, "document.querySelector('#garmin-dialog').open && document.querySelector('#garmin-dialog [data-native-action=connect]') !== null")
            _ = try await web.evaluateJavaScript("document.querySelector('#garmin-dialog [data-native-action=connect]').click()")
            let sheet = try await waitForSheet(web)
            guard hasSecureField(sheet.contentView) else {
                throw SmokeFailure(description: "A native secure field did not appear for the API key")
            }
            web.window?.endSheet(sheet, returnCode: .alertSecondButtonReturn)
            try await waitFor(web, "document.querySelector('.app-shell').dataset.mode === 'demo' && !document.querySelector('#connection-message').textContent")

            let blocked = try await web.callAsyncJavaScript("""
                return await new Promise(resolve => {
                  const timer = setTimeout(() => resolve(false), 1000);
                  window.addEventListener("securitypolicyviolation", event => {
                    if (event.effectiveDirective === "connect-src") {
                      clearTimeout(timer);
                      resolve(true);
                    }
                  }, { once: true });
                  fetch("https://example.invalid/").catch(() => {});
                });
                """, arguments: [:], in: nil, contentWorld: .page) as? Bool
            guard blocked == true else { throw SmokeFailure(description: "Remote page request was not blocked") }
            print("Native onboarding, demo, view navigation, Garmin settings, native secure field and no remote WebKit fetch verified.")
            exit(0)
        } catch {
            let page = (try? await web.evaluateJavaScript("document.body?.innerText ?? ''")) as? String ?? ""
            fputs("WebKit smoke test failed: \(error)\n\(page)\n", stderr)
            exit(1)
        }
    }
}

private struct SmokeFailure: Error { let description: String }

@MainActor
private func waitFor(_ view: WKWebView, _ condition: String) async throws {
    for _ in 0..<90 {
        if (try? await view.evaluateJavaScript(condition)) as? Bool == true { return }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw SmokeFailure(description: condition)
}

@MainActor
private func capture(_ view: WKWebView, directory: String, filename: String) async throws {
    let picture = try await view.takeSnapshot(configuration: nil)
    guard let tiff = picture.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        throw SmokeFailure(description: "Preview capture failed")
    }
    try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent(filename))
}


@MainActor
private func waitForSheet(_ web: WKWebView) async throws -> NSWindow {
    for _ in 0..<40 {
        if let sheet = web.window?.attachedSheet { return sheet }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw SmokeFailure(description: "The Garmin key entry sheet did not open")
}

@MainActor
private func hasSecureField(_ view: NSView?) -> Bool {
    guard let view else { return false }
    return view is NSSecureTextField || view.subviews.contains { hasSecureField($0) }
}
