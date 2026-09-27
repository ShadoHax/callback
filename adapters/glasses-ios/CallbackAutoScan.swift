import Foundation
import UIKit

// Feed the UIImage decoded for preview by Meta's CameraAccess sample while
// discovery is enabled and its stream is active. No capture button is needed.
@MainActor
final class CallbackAutoScan {
    private let client: CallbackDeviceClient
    private let onConnection: ([String: Any]) -> Void
    private let onError: (String) -> Void
    private var enabled = false
    private var inFlight = false
    private var lastAttempt = Date.distantPast
    private var lastConnection = ""

    init(client: CallbackDeviceClient, onConnection: @escaping ([String: Any]) -> Void, onError: @escaping (String) -> Void) {
        self.client = client
        self.onConnection = onConnection
        self.onError = onError
    }

    func start() { lastConnection = ""; enabled = true }
    func stop() { enabled = false }

    func offer(frame: UIImage) {
        guard enabled, !inFlight, Date().timeIntervalSince(lastAttempt) >= 20,
              let jpeg = frame.jpegData(compressionQuality: 0.78) else { return }
        lastAttempt = Date()
        inFlight = true
        Task {
            defer { inFlight = false }
            do {
                let response = try await client.scanPhoto(jpeg: jpeg)
                guard enabled else { return }
                if let error = response.events.first(where: { $0["type"] as? String == "error" }) {
                    onError(error["message"] as? String ?? "Scan failed.")
                    return
                }
                guard (200...299).contains(response.status) else { onError("Scan failed (\(response.status))."); return }
                guard let result = response.events.first(where: { $0["type"] as? String == "result" })?["result"] as? [String: Any],
                      result["status"] as? String == "matched" else { return }
                let key = ["person", "observedEntity", "relation"].map { result[$0] as? String ?? "" }.joined(separator: "|")
                if key != lastConnection { lastConnection = key; onConnection(result) }
            } catch { onError(error.localizedDescription) }
        }
    }
}
