using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Networking;

// Add to the official Quest Passthrough Camera API sample scene.
// Call ScanTexture(cameraAccess.GetTexture()) after its camera is playing and a user presses Scan.
// Enter the short-lived token at runtime; never serialize it in a Unity scene or asset.
public sealed class CallbackQuestBridge : MonoBehaviour
{
    [Serializable] private sealed class ScanResult { public string status; public string person; public string observedEntity; public string relation; }
    [Serializable] private sealed class ScanEvent { public string type; public string message; public ScanResult result; }

    public UnityEvent<string> OnStage;
    public UnityEvent<string> OnResultJson;
    public UnityEvent<string> OnError;

    private string baseUrl;
    private string deviceToken;
    private bool scanning;
    private bool autoEnabled;
    private float nextAutoScanAt;
    private readonly CallbackQuestAlertGate alertGate = new CallbackQuestAlertGate();
    public Func<Texture> AutoFrameProvider { get; set; }

    public void Configure(string httpsBaseUrl, string scanOnlyToken)
    {
        if (!Uri.TryCreate(httpsBaseUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new ArgumentException("Callback requires an HTTPS base URL.");
        baseUrl = httpsBaseUrl.TrimEnd('/');
        deviceToken = scanOnlyToken;
    }

    public void ScanTexture(Texture cameraTexture)
    {
        SubmitTexture(cameraTexture, false);
    }

    private void SubmitTexture(Texture cameraTexture, bool automatic)
    {
        if (scanning) { OnError?.Invoke("A scan is already running."); return; }
        if (cameraTexture == null) { OnError?.Invoke("Camera frame is unavailable."); return; }
        if (string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(deviceToken)) { OnError?.Invoke("Pair the Quest before scanning."); return; }
        StartCoroutine(UploadFrame(cameraTexture, automatic));
    }

    // Supply the official sample's cameraAccess.GetTexture() as AutoFrameProvider.
    // Auto discovery runs only while explicitly enabled in the headset UI.
    public void StartAutoDiscovery() { alertGate.Start(); autoEnabled = true; nextAutoScanAt = Time.unscaledTime; }
    public void StopAutoDiscovery() { autoEnabled = false; alertGate.Stop(); }
    private void Update()
    {
        if (!autoEnabled || scanning || Time.unscaledTime < nextAutoScanAt || AutoFrameProvider == null) return;
        nextAutoScanAt = Time.unscaledTime + 20f;
        var frame = AutoFrameProvider();
        if (frame != null) SubmitTexture(frame, true);
    }

    private IEnumerator UploadFrame(Texture frame, bool automatic)
    {
        scanning = true;
        byte[] jpeg;
        try { jpeg = EncodeJpeg(frame); }
        catch (Exception) { OnError?.Invoke("Could not read the camera frame."); scanning = false; yield break; }
        if (jpeg.Length == 0 || jpeg.Length > 8 * 1024 * 1024) { OnError?.Invoke("Camera frame exceeds the 8 MB limit."); scanning = false; yield break; }

        var form = new List<IMultipartFormSection> { new MultipartFormFileSection("image", jpeg, "quest.jpg", "image/jpeg") };
        using (var request = UnityWebRequest.Post(baseUrl + "/api/device/scans", form))
        {
            request.SetRequestHeader("Authorization", "Bearer " + deviceToken);
            request.timeout = 60;
            yield return request.SendWebRequest();
            var body = request.downloadHandler?.text ?? "";
            if (string.IsNullOrWhiteSpace(body)) { OnError?.Invoke("The scan service returned no trace."); scanning = false; yield break; }
            foreach (var line in body.Split('\n'))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                ScanEvent scanEvent;
                try { scanEvent = JsonUtility.FromJson<ScanEvent>(line); }
                catch (Exception) { OnError?.Invoke("The scan trace was invalid."); break; }
                if (scanEvent.type == "error") OnError?.Invoke(scanEvent.message);
                else if (scanEvent.type == "result")
                {
                    if (!automatic) OnResultJson?.Invoke(line);
                    else if (autoEnabled && scanEvent.result != null)
                    {
                        if (alertGate.ShouldAlert(scanEvent.result.status, scanEvent.result.person, scanEvent.result.observedEntity, scanEvent.result.relation)) OnResultJson?.Invoke(line);
                    }
                }
                else OnStage?.Invoke(scanEvent.message);
            }
        }
        scanning = false;
    }

    private static byte[] EncodeJpeg(Texture source)
    {
        CallbackQuestFramePolicy.Size(source.width, source.height, 1024, out var width, out var height);
        var target = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32);
        var previous = RenderTexture.active;
        Texture2D readable = null;
        try
        {
            Graphics.Blit(source, target);
            RenderTexture.active = target;
            readable = new Texture2D(width, height, TextureFormat.RGB24, false);
            readable.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            readable.Apply();
            return readable.EncodeToJPG(85);
        }
        finally
        {
            RenderTexture.active = previous;
            if (readable != null) UnityEngine.Object.Destroy(readable);
            RenderTexture.ReleaseTemporary(target);
        }
    }
}
