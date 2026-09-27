package app.callback.bridge

import java.util.UUID

data class CallbackMatch(val scanId: String, val recipientId: String, val person: String, val item: String, val relation: String)
data class CallbackReply(val id: Long, val senderName: String, val body: String)
data class CallbackReplyBatch(val replies: List<CallbackReply>, val cursor: Long)

interface CallbackConversationTransport {
    fun sendReviewed(scanId: String, recipientId: String, body: String, clientRequestId: String): Boolean
    fun pollReplies(after: Long): CallbackReplyBatch
}

/** Host speech recognition calls editDraft/confirmSend/cancel; `speak` should use platform TTS. */
class CallbackVoiceConversation(private val transport: CallbackConversationTransport, private val speak: (String) -> Unit) {
    private var pending: CallbackMatch? = null
    private var draft = ""
    private var requestId = ""
    private var cursor = 0L

    fun onMatch(match: CallbackMatch) {
        pending = match
        requestId = UUID.randomUUID().toString()
        draft = when (match.relation) {
            "planned_together" -> "I just came across ${match.item} and remembered our plan. Still want to do it together?"
            "asked_to_find" -> "I came across ${match.item} and remembered you asked me to look out for one. Want the details?"
            "wanted" -> "I saw ${match.item} and thought of you. Is this the one you were looking for?"
            "recommended" -> "I just came across ${match.item}, the one you recommended. What did you like about it?"
            else -> "Saw ${match.item} and thought of you!"
        }
        speak("This reminded you of ${match.person}. Draft: $draft. Say send, edit, or cancel.")
    }

    fun editDraft(text: String) {
        if (pending == null || text.isBlank()) return
        draft = text.trim()
        requestId = UUID.randomUUID().toString()
        speak("Updated draft: $draft. Say send or cancel.")
    }

    fun confirmSend() {
        val match = pending ?: return
        speak("Sending to ${match.person}: $draft")
        if (transport.sendReviewed(match.scanId, match.recipientId, draft, requestId)) {
            speak("Sent. I will read their reply when it arrives.")
            pending = null
        } else speak("I could not confirm the send. I will not send it twice.")
    }

    fun cancel() { pending = null; draft = ""; requestId = ""; speak("Cancelled.") }

    fun poll() {
        val batch = transport.pollReplies(cursor)
        for (reply in batch.replies) speak("${reply.senderName} replied: ${reply.body}")
        cursor = maxOf(cursor, batch.cursor)
    }
}
