import Foundation

// Copy into Meta's CameraAccess iOS sample. Pass the JPEG Data emitted by
// stream.photoDataPublisher after the wearer intentionally requests a photo.
struct CallbackDeviceClient {
    let baseURL: URL
    let token: String

    struct ScanResponse {
        let status: Int
        let events: [[String: Any]]
    }

    func scanPhoto(jpeg: Data) async throws -> ScanResponse {
        guard baseURL.scheme == "https" else { throw BridgeError.httpsRequired }
        guard !jpeg.isEmpty && jpeg.count <= 8 * 1024 * 1024 else { throw BridgeError.invalidImage }
        let boundary = "callback-\(UUID().uuidString)"
        let url = baseURL.appendingPathComponent("api/device/scans")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"glasses.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8)
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let (responseData, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw BridgeError.invalidResponse }
        let lines = responseData.split(separator: 0x0A).filter { !$0.isEmpty }
        let events = try lines.map { line -> [String: Any] in
            guard let value = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { throw BridgeError.invalidResponse }
            return value
        }
        return ScanResponse(status: http.statusCode, events: events)
    }

    func sendReviewed(scanId: String, recipientId: String, body: String, clientRequestId: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/device/messages"))
        request.httpMethod = "POST"; request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["scanId": scanId, "recipientId": recipientId, "body": body, "clientRequestId": clientRequestId])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw BridgeError.invalidResponse }
    }

    func pollReplies(after: Int64) async throws -> CallbackReplyBatch {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/device/events"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "after", value: String(after))]
        var request = URLRequest(url: components.url!); request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw BridgeError.invalidResponse }
        let replies = (root["events"] as? [[String: Any]] ?? []).compactMap { event -> CallbackReply? in
            guard event["kind"] as? String == "reply", let payload = event["payload"] as? [String: Any], let id = event["id"] as? NSNumber, let body = payload["body"] as? String else { return nil }
            return CallbackReply(id: id.int64Value, senderName: payload["senderName"] as? String ?? "Someone", body: body)
        }
        return CallbackReplyBatch(replies: replies, cursor: (root["cursor"] as? NSNumber)?.int64Value ?? after)
    }

    enum BridgeError: Error { case httpsRequired, invalidImage, invalidResponse }
}
