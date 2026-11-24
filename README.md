# Ground Truth

Ground Truth is a Mac dashboard for exploring your Garmin sleep, HRV, recovery, and activities. It stores a rolling 30-day snapshot locally.

## Try the Mac preview

1. Unzip the **Ground Truth macOS preview** download and open **Ground Truth.app**. It runs on Apple silicon or Intel with macOS 13 or newer.
2. Select **Try demo** to browse synthetic data, or **Create Garmin key** to open Garmin Connect in your browser.
3. In Garmin Connect, sign in and choose **Create Key**. Pick an expiration and copy the key. Back in Ground Truth, choose **Enter key** and paste it into the macOS prompt.
4. Use **Sync now** after your watch syncs with Garmin Connect. Open **Garmin** in the dashboard to check the date range, replace an expired key, or disconnect.

The preview is an ad-hoc-signed test build. If Gatekeeper asks you to verify it, use Apple's app-specific **Open Anyway** instructions for this build. [Apple Support](https://support.apple.com/en-us/102445)

Garmin and watch support determine which records come through. Dashes mean the API did not supply a usable reading. This preview uses summary data and does not include Training Readiness, minute-level views, the forecast models, or the training plan. [Garmin Personal API docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs)

## Account and data

- Ground Truth accepts a revocable Personal API key through a native secure field and saves it in macOS Keychain. It exchanges the key for a session token in memory and sends requests only to Garmin's Personal API host. [Key setup and revocation](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- The dashboard runs inside the Mac app. A filtered snapshot is stored in your user Library. The app has no service to share your data and no telemetry.
- **Disconnect** deletes the saved key and snapshot from this Mac. To invalidate the key at Garmin, delete it in [Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken).

## Build and test

Install the macOS Command Line Tools on a development Mac, then run:

```sh
./scripts/test.sh
./scripts/build.sh
```

The build writes a versioned universal ZIP and its SHA-256 checksum to `dist/`. The app uses macOS system frameworks and needs no runtimes installed by users. `./scripts/web-smoke.sh` runs the native WebKit smoke test on a Mac with an active GUI session. Tests use synthetic data and have no need for a Garmin account.

[MIT License](LICENSE)
