# Quest and AI glasses bridges

Callback accepts camera captures from an enabled device session through the same private scan pipeline used by the phone. A signed-in user creates a 24-hour token at `/devices`. Quest tokens remain scan-only. **Glasses voice messaging is experimental and off by default** behind the server-only `GLASSES_MESSAGING_ENABLED=true` setting. When enabled, a glasses token can send an explicitly reviewed message for a scan created by that exact token, to a recipient already verified in that saved result, and receive replies for that device. The token is shown once and can be revoked; scan results can include private source excerpts, so protect it. The server derives the capture source from the token; clients cannot choose another device type.

## Shared endpoint

`POST /api/device/scans` requires `Authorization: Bearer cbdev_...` and a multipart `image` file (JPG, PNG, or WebP, up to 8 MB). It returns newline-delimited JSON events. A successful trace ends with `type: "result"` and a `result` object; failures emit `type: "error"`. The response should be treated as a scan suggestion for review in Callback. It does not trigger a message.

Use an HTTPS base URL reachable from the headset or paired phone. `localhost` on that device does not point to the development PC. Keep the token in app memory or secure platform storage, never in source control, a Unity scene, or logs. Pair again when it expires. The server atomically limits each device token to one scan every 20 seconds.

## Quest 3 / 3S

Start with Meta's [Passthrough Camera API sample](https://github.com/oculus-samples/Unity-PassthroughCameraApiSamples) and its [setup requirements](https://developers.meta.com/horizon/documentation/unity/unity-pca-overview/). Add `quest-unity/CallbackQuestBridge.cs` and `quest-unity/CallbackQuestPolicies.cs` to a scene. After the sample has obtained camera permission and is producing frames, call `Configure(httpsBaseUrl, token)`, assign `AutoFrameProvider = () => cameraAccess.GetTexture()`, and call `StartAutoDiscovery()` when the wearer enables discovery. Call `StopAutoDiscovery()` when discovery ends. The bridge samples one frame about every 20 seconds, bounds its longest image edge to 1024 pixels, suppresses repeated connection alerts during the session, and exposes `OnResultJson` and `OnError` for the headset UI. `ScanTexture(...)` remains available for a manual scan.

The official sample currently targets Quest 3/3S and requires a supported Horizon OS and Unity/Meta SDK setup. Camera access must be tested on a headset; the Meta simulator does not supply the passthrough camera feed.

## Meta AI glasses

Meta's [Device Access Toolkit](https://developers.meta.com/wearables/device-access-toolkit/) supplies the capture stream through a paired phone. Add the transport client to the official [Android](https://github.com/facebook/meta-wearables-dat-android) or [iOS](https://github.com/facebook/meta-wearables-dat-ios) camera sample:

- Android: add `CallbackDeviceClient.kt`, `CallbackAutoScan.kt`, and `CallbackDatDiscovery.kt` to the official CameraAccess sample. In its camera ViewModel, construct `CallbackDatDiscovery(viewModelScope, client, { stream }, onConnection, onError)`. Start it when the wearer enables discovery **and** the stream is active; stop it on stream termination, pause, or disabling discovery. `CallbackDatDiscovery` calls the current Meta DAT `Stream.capturePhoto()` and passes `PhotoData.data` to the controller. The controller performs HTTPS on `Dispatchers.IO`.
- iOS: add `CallbackDeviceClient.swift` and `CallbackAutoScan.swift` to the official CameraAccess Xcode target. After its preview decoder sets `currentVideoFrame = image`, call `autoScan.offer(frame: image)` on the main actor. Start the controller when discovery is enabled and the stream is active; stop it when either ends. It JPEG-encodes at most one frame every 20 seconds and uploads asynchronously.

The LLM does not activate the camera or select frames by itself. The native controller samples an active camera session and sends frames to the model. A match is surfaced once per person, item, and relation during that session; no match causes no alert. The official sample owns device pairing, camera lifecycle, permissions, and the discovery on/off control.

`CallbackVoiceConversation` provides an **experimental** hands-free review state on Android and iOS. A companion app must wire its output to platform text-to-speech, map speech-recognizer results to `editDraft`, `confirmSend`, or `cancel`, and keep reply polling active during the voice session. The draft is spoken for review and is sent only after an explicit `confirmSend`; reply events are scoped to the originating glasses token. Before enabling messaging, apply `supabase/migrations/20260926_glasses_voice_messages.sql` to the target project, validate the native build and actual glasses/paired-phone session, and verify that spoken edit, cancel, and confirm choices work under realistic conditions. Then set server-only `GLASSES_MESSAGING_ENABLED=true` on that environment and redeploy. Leave it unset or `false` for the chosen phone demo.

The signed-in owner can still open a device scan from **Show recent scans** in the Callback phone app. The experimental glasses voice flow sends only the spoken draft; sharing the photo or a recipient-authored excerpt still requires review in Callback. The selected M1/V3 presentation uses two phones, and no glasses voice-message hardware validation is claimed.

## Verification status

The Next.js endpoint, token checks, native multipart format, throttle, provenance, and shared scan path have local tests and build checks. Earlier adapter checks compiled the Quest bridge against Unity references and the Android Kotlin bridge against minimal Meta DAT-shaped stubs; the Pi client has a mock HTTP polling and cursor replay test. These source and behavior checks do **not** establish a real SDK, camera, microphone, or glasses messaging session. Native Android/iOS integration, speech recognition and text-to-speech wiring, explicit spoken confirmation, and hardware testing remain required before enabling voice messaging or showing it live. A trial also needs configured Supabase and Muse Spark credentials, approved source data, HTTPS access from the device, and the corresponding hardware. The phone M1/V3 flow remains the primary demo.

## Relation names

The scan pipeline reports typed relation names, including the M1/V3 `inspired` and `prefers` relations. Device payloads keep the same fields (`status`, `person`, `observedEntity`, `relation`); legacy values map as follows:

| Old | New |
|---|---|
| `wish` | `wanted`, `asked_to_find` |
| `shared_plan` | `planned_together` |
| `recommendation` | `recommended` |
| `gift` | `gifted` |
| `memory` | `experienced_together` |

Negative relations (`owns`, `dislikes`, `cancelled`, `purchased_as_gift`) never appear on a match. The Pi beacon accepts both the legacy names and the current relation names.
