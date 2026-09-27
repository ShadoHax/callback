package app.callback.bridge

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

// Copy into Meta's CameraAccess Android sample. Call from Dispatchers.IO after
// camera.stream.capturePhoto() returns photoData.data; never run network I/O on the UI thread.
interface CallbackScanTransport {
    fun scanPhoto(jpeg: ByteArray): CallbackDeviceClient.ScanResponse
}

class CallbackDeviceClient(private val baseUrl: String, private val token: String) : CallbackScanTransport, CallbackConversationTransport {
    data class ScanResponse(val status: Int, val events: List<JSONObject>)

    override fun scanPhoto(jpeg: ByteArray): ScanResponse {
        require(baseUrl.startsWith("https://")) { "Callback requires HTTPS." }
        require(jpeg.isNotEmpty() && jpeg.size <= 8 * 1024 * 1024) { "JPEG must be under 8 MB." }
        val boundary = "callback-${java.util.UUID.randomUUID()}"
        val connection = URI.create(baseUrl.trimEnd('/') + "/api/device/scans").toURL().openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connection.outputStream.use { output ->
                output.write("--$boundary\r\nContent-Disposition: form-data; name=\"image\"; filename=\"glasses.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".toByteArray(Charsets.UTF_8))
                output.write(jpeg)
                output.write("\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val events = mutableListOf<JSONObject>()
            if (stream != null) BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
                reader.forEachLine { line -> if (line.isNotBlank()) events.add(JSONObject(line)) }
            }
            return ScanResponse(status, events)
        } finally {
            connection.disconnect()
        }
    }

    override fun sendReviewed(scanId: String, recipientId: String, body: String, clientRequestId: String): Boolean {
        val json = "{\"scanId\":\"${escape(scanId)}\",\"recipientId\":\"${escape(recipientId)}\",\"body\":\"${escape(body)}\",\"clientRequestId\":\"${escape(clientRequestId)}\"}"
        val connection = URI.create(baseUrl.trimEnd('/') + "/api/device/messages").toURL().openConnection() as HttpsURLConnection
        return try {
            connection.requestMethod = "POST"; connection.doOutput = true; connection.connectTimeout = 15_000; connection.readTimeout = 30_000
            connection.setRequestProperty("Authorization", "Bearer $token"); connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            connection.responseCode in 200..299
        } finally { connection.disconnect() }
    }

    override fun pollReplies(after: Long): CallbackReplyBatch {
        val connection = URI.create(baseUrl.trimEnd('/') + "/api/device/events?after=$after").toURL().openConnection() as HttpsURLConnection
        return try {
            connection.requestMethod = "GET"; connection.connectTimeout = 15_000; connection.readTimeout = 30_000
            connection.setRequestProperty("Authorization", "Bearer $token")
            val root = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val events = root.optJSONArray("events")
            val replies = mutableListOf<CallbackReply>()
            if (events != null) for (index in 0 until events.length()) {
                val event = events.optJSONObject(index) ?: continue
                if (event.optString("kind") != "reply") continue
                val payload = event.optJSONObject("payload") ?: continue
                replies.add(CallbackReply(event.optLong("id"), payload.optString("senderName", "Someone"), payload.optString("body")))
            }
            CallbackReplyBatch(replies, root.optLong("cursor", after))
        } finally { connection.disconnect() }
    }

    private fun escape(value: String) = buildString {
        for (char in value) append(when (char) { '\\' -> "\\\\"; '"' -> "\\\""; '\n' -> "\\n"; '\r' -> "\\r"; '\t' -> "\\t"; else -> char })
    }
}
