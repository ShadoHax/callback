package app.callback.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;

public final class MainActivity extends Activity {
    private static final String APP_URL = "https://callback-khaki-phi.vercel.app";
    private static final String APP_HOST = "callback-khaki-phi.vercel.app";
    private static final int CAMERA_PERMISSION_CODE = 10;
    private static final int CAMERA_FILE_CODE = 11;
    private static final int PICK_FILE_CODE = 12;

    private WebView webView;
    private View errorView;
    private PermissionRequest pendingCameraPermission;
    private ValueCallback<Uri[]> pendingFileResult;
    private Uri pendingCameraUri;
    private File pendingCameraFile;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248, 245, 239));
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return windowInsets;
            });
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 245, 239));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return openOutsideIfNeeded(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                errorView.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) errorView.setVisibility(View.VISIBLE);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCameraPermission == request) pendingCameraPermission = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                String currentUrl = view.getUrl();
                if (currentUrl == null || !isCallbackOrigin(Uri.parse(currentUrl))) {
                    callback.onReceiveValue(null);
                    return true;
                }
                if (pendingFileResult != null) pendingFileResult.onReceiveValue(null);
                pendingFileResult = callback;
                if (params.isCaptureEnabled() && acceptsImage(params) && launchCamera()) return true;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE_CODE);
                } catch (ActivityNotFoundException | SecurityException exception) {
                    finishFileRequest(null);
                }
                return true;
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        errorView = createErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            root.post(() -> {
                WindowInsetsController controller = root.getWindowInsetsController();
                if (controller != null) {
                    controller.setSystemBarsAppearance(
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                }
            });
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(APP_URL);
        }
    }

    private View createErrorView() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(28), dp(28), dp(28));
        panel.setBackgroundColor(Color.rgb(248, 245, 239));

        TextView message = new TextView(this);
        message.setText(R.string.load_error);
        message.setTextColor(Color.rgb(37, 31, 26));
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);
        panel.addView(message);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = dp(20);
        panel.addView(retry, buttonParams);
        retry.setOnClickListener(view -> webView.reload());
        return panel;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean isCallbackOrigin(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && APP_HOST.equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private boolean openOutsideIfNeeded(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if ("https".equalsIgnoreCase(scheme)) {
            if (isCallbackOrigin(uri) || (host != null &&
                (host.equalsIgnoreCase("stripe.com") || host.toLowerCase(java.util.Locale.ROOT).endsWith(".stripe.com")))) {
                return false;
            }
            openExternal(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        }
        if ("sms".equalsIgnoreCase(scheme) || "smsto".equalsIgnoreCase(scheme)) {
            openExternal(new Intent(Intent.ACTION_SENDTO, uri));
            return true;
        }
        if ("tel".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme)) {
            openExternal(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        }
        return !"about".equalsIgnoreCase(scheme) && !"blob".equalsIgnoreCase(scheme);
    }

    private void openExternal(Intent intent) {
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException ignored) {
            // An unavailable external app must not crash Callback.
        }
    }

    private void handleWebPermission(PermissionRequest request) {
        if (!isCallbackOrigin(request.getOrigin())) {
            request.deny();
            return;
        }
        boolean wantsVideo = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsVideo = true;
        }
        if (!wantsVideo) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        if (pendingCameraPermission != null) pendingCameraPermission.deny();
        pendingCameraPermission = request;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_CODE || pendingCameraPermission == null) return;
        PermissionRequest request = pendingCameraPermission;
        pendingCameraPermission = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            request.deny();
        }
    }

    private boolean acceptsImage(WebChromeClient.FileChooserParams params) {
        for (String type : params.getAcceptTypes()) {
            if (type != null && type.startsWith("image/")) return true;
        }
        return false;
    }

    private boolean launchCamera() {
        try {
            File cameraDir = new File(getCacheDir(), "camera");
            if (!cameraDir.exists() && !cameraDir.mkdirs()) return false;
            pendingCameraFile = File.createTempFile("callback-", ".jpg", cameraDir);
            pendingCameraUri = FileProvider.getUriForFile(
                this, getPackageName() + ".files", pendingCameraFile);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
            intent.setClipData(ClipData.newRawUri("Callback photo", pendingCameraUri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(intent, CAMERA_FILE_CODE);
            return true;
        } catch (IOException | ActivityNotFoundException | SecurityException exception) {
            clearCameraFile();
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (pendingFileResult == null) return;
        if (requestCode == CAMERA_FILE_CODE) {
            Uri selected = resultCode == RESULT_OK && pendingCameraFile != null
                && pendingCameraFile.length() > 0 ? pendingCameraUri : null;
            finishFileRequest(selected == null ? null : new Uri[]{selected});
            if (selected == null) clearCameraFile();
            else {
                pendingCameraFile = null;
                pendingCameraUri = null;
            }
        } else if (requestCode == PICK_FILE_CODE) {
            finishFileRequest(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        }
    }

    private void finishFileRequest(Uri[] selected) {
        if (pendingFileResult != null) pendingFileResult.onReceiveValue(selected);
        pendingFileResult = null;
    }

    private void clearCameraFile() {
        if (pendingCameraFile != null) pendingCameraFile.delete();
        pendingCameraFile = null;
        pendingCameraUri = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingCameraPermission != null) pendingCameraPermission.deny();
        if (pendingFileResult != null) finishFileRequest(null);
        webView.destroy();
        super.onDestroy();
    }
}
