package app.callback.bridge

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

private class FakeTransport(private val status: String) : CallbackScanTransport {
    var attempts = 0
    override fun scanPhoto(jpeg: ByteArray): CallbackDeviceClient.ScanResponse {
        check(jpeg.contentEquals(byteArrayOf(1, 2, 3)))
        attempts++
        val result = JSONObject(mapOf("status" to status, "person" to "maya", "observedEntity" to "X100V", "relation" to "wish"))
        return CallbackDeviceClient.ScanResponse(200, listOf(JSONObject(mapOf("type" to "result", "result" to result))))
    }
}

private class FakeConversationTransport : CallbackConversationTransport {
    var sent = 0
    override fun sendReviewed(scanId: String, recipientId: String, body: String, clientRequestId: String): Boolean {
        check(scanId == "scan" && recipientId == "maya-account" && body.contains("Wingspan") && clientRequestId.isNotBlank())
        sent++
        return true
    }
    override fun pollReplies(after: Long) = if (after < 4) CallbackReplyBatch(listOf(CallbackReply(4, "Maya", "Sunday works!")), 4) else CallbackReplyBatch(emptyList(), 4)
}

fun main() = runBlocking {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val matched = FakeTransport("matched")
    var alerts = 0
    val discovery = CallbackAutoScan(scope, matched, { byteArrayOf(1, 2, 3) }, { alerts++ }, { error(it) }, intervalMillis = 25)
    discovery.start()
    delay(140)
    check(matched.attempts >= 2) { "Automatic capture did not repeat." }
    check(alerts == 1) { "Repeated views of the same connection triggered $alerts alerts." }
    discovery.stop()
    val stoppedAt = matched.attempts
    delay(80)
    check(matched.attempts == stoppedAt) { "Capture continued after discovery stopped." }

    val unmatched = FakeTransport("no_match")
    val quiet = CallbackAutoScan(scope, unmatched, { byteArrayOf(1, 2, 3) }, { alerts++ }, { error(it) }, intervalMillis = 25)
    quiet.start()
    delay(80)
    quiet.stop()
    check(unmatched.attempts > 0 && alerts == 1) { "No-match produced an alert." }
    val transport = FakeConversationTransport()
    val spoken = mutableListOf<String>()
    val voice = CallbackVoiceConversation(transport) { spoken.add(it) }
    voice.onMatch(CallbackMatch("scan", "maya-account", "Maya", "Wingspan", "planned_together"))
    check(spoken.last().contains("Say send, edit, or cancel"))
    voice.confirmSend()
    check(transport.sent == 1 && spoken.last().contains("read their reply"))
    voice.poll(); voice.poll()
    check(spoken.count { it.contains("Maya replied: Sunday works!") } == 1) { "Reply was not read exactly once." }
    scope.cancel()
    println("Android automatic discovery checks passed.")
}
