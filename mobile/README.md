# Burgfried Android-App

Die Android-App ist eine Capacitor-Hülle für die bestehende Burgfried-Web-App. Sie öffnet die zentrale Web-App im Vollbild-WebView, sodass Spielregeln, 2–8-Spieler-Modus, Computergegner und die Renderer-Fixes nicht doppelt gepflegt werden müssen.

## Build

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```

Die Debug-APK liegt danach unter `android/app/build/outputs/apk/debug/app-debug.apk`.

## Server-Adresse

Die Adresse wird in `capacitor.config.json` unter `server.url` gesetzt. Die Android-App benötigt eine erreichbare, per HTTPS veröffentlichte Burgfried-Web-App. Wenn der Render-Dienst noch nicht erreichbar ist, startet die APK zwar, kann aber keine Spieloberfläche laden.
