package app.callback.bridge

import com.meta.wearable.dat.camera.Stream
import kotlinx.coroutines.CoroutineScope
import org.json.JSONObject

// Concrete Meta DAT 1.0 CameraAccess connection. Supply the sample ViewModel's
// current stream so a reconnect automatically uses the new Stream instance.
class CallbackDatDiscovery(
    scope: CoroutineScope,
    client: CallbackDeviceClient,
    streamProvider: () -> Stream?,
    onConnection: (JSONObject) -> Unit,
    onError: (String) -> Unit,
) {
    private val auto = CallbackAutoScan(
        scope = scope,
        client = client,
        captureJpeg = {
            var jpeg: ByteArray? = null
            streamProvider()?.capturePhoto()?.onSuccess { photo -> jpeg = photo.data }
            jpeg
        },
        onConnection = onConnection,
        onError = onError,
    )

    fun start() = auto.start()
    fun stop() = auto.stop()
}
