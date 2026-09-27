# Callback Android APK

This Android app opens the deployed Callback service at `https://callback-khaki-phi.vercel.app`. The Next.js API routes, Supabase session, model calls, and test checkout continue to run on the hosted service. An internet connection is required.

The shell supports the live camera, camera capture and photo selection, Android SMS links, and navigation back from hosted pages. Camera access is granted only to the Callback origin. Other sites cannot request camera access or select files through the shell.

## Build

Install JDK 17 and Android SDK Platform 35 / Build Tools 35.0.0, then set `JAVA_HOME` and `ANDROID_HOME`. From this directory run:

```powershell
.\gradlew.bat assembleDebug
```

The installable debug APK is `app/build/outputs/apk/debug/app-debug.apk`. It is signed with the Android debug key and is meant for direct installation and testing, not Play Store release. Install with `adb install -r app/build/outputs/apk/debug/app-debug.apk` or copy it to an Android phone and open it there.

The minimum supported version is Android 8.0 (API 26). Installing the file directly on a phone may require enabling **Install unknown apps** for the app used to open it.

The app uses the existing hosted deployment. Changes to the Next.js site must be deployed separately before they appear in the APK. The personal-app sharing button can copy text to the clipboard on WebView; the addressed SMS link opens Android Messages. Stripe test checkout runs inside WebView and still needs a physical-device check.

## Verified September 26, 2026

`assembleDebug` and `lintDebug` completed, with zero lint errors. The final APK passed signature and ZIP alignment checks, installed on an Android 15 emulator, launched, loaded the hosted page, displayed the live camera after permission was granted, opened the account sign-in screen, and launched Android's photo picker. There were no Android runtime crashes in that run. A physical phone, authenticated flows, SMS, and Stripe checkout have not been tested with this APK.
