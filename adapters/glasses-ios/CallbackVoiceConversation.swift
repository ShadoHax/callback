import Foundation

struct CallbackMatch {
    let scanId: String, recipientId: String, person: String, item: String, relation: String
}
struct CallbackReply { let id: Int64, senderName: String, body: String }
struct CallbackReplyBatch { let replies: [CallbackReply], cursor: Int64 }

@MainActor
final class CallbackVoiceConversation {
    private let client: CallbackDeviceClient
    private let speak: (String) -> Void
    private var pending: CallbackMatch?
    private var draft = ""
    private var requestId = UUID().uuidString
    private var cursor: Int64 = 0

    init(client: CallbackDeviceClient, speak: @escaping (String) -> Void) { self.client = client; self.speak = speak }

    func onMatch(_ match: CallbackMatch) {
        pending = match; requestId = UUID().uuidString
        switch match.relation {
        case "planned_together": draft = "I just came across \(match.item) and remembered our plan. Still want to do it together?"
        case "asked_to_find": draft = "I came across \(match.item) and remembered you asked me to look out for one. Want the details?"
        case "wanted": draft = "I saw \(match.item) and thought of you. Is this the one you were looking for?"
        case "recommended": draft = "I just came across \(match.item), the one you recommended. What did you like about it?"
        default: draft = "Saw \(match.item) and thought of you!"
        }
        speak("This reminded you of \(match.person). Draft: \(draft). Say send, edit, or cancel.")
    }

    func editDraft(_ text: String) { guard pending != nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }; draft = text; requestId = UUID().uuidString; speak("Updated draft: \(draft). Say send or cancel.") }
    func cancel() { pending = nil; draft = ""; speak("Cancelled.") }

    func confirmSend() async {
        guard let match = pending else { return }
        speak("Sending to \(match.person): \(draft)")
        do { try await client.sendReviewed(scanId: match.scanId, recipientId: match.recipientId, body: draft, clientRequestId: requestId); pending = nil; speak("Sent. I will read their reply when it arrives.") }
        catch { speak("I could not confirm the send. I will not send it twice.") }
    }

    func poll() async {
        guard let batch = try? await client.pollReplies(after: cursor) else { return }
        batch.replies.forEach { speak("\($0.senderName) replied: \($0.body)") }
        cursor = max(cursor, batch.cursor)
    }
}
