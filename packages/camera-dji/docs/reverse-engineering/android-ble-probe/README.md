# Disposable Android BLE DUML probe

`build.sh` produces a signed local APK without Gradle. It is evidence tooling, not a
camera controller. The probe accepts only complete raw DUML frames whose length,
CRC-8, and CRC-16 are valid; it never constructs camera commands.

Install and grant Bluetooth permissions:

```sh
zsh build.sh
adb install -r out/duml-ble-probe.apk
adb shell pm grant com.mandltv.dumlprobe android.permission.BLUETOOTH_SCAN
adb shell pm grant com.mandltv.dumlprobe android.permission.BLUETOOTH_CONNECT
```

Before launch, force-stop Mimo and disable Wi-Fi. Pass comma-separated complete
DUML frames with `frames`; an omitted value provides scan/connect/subscribe evidence
only. The activity writes JSONL to its app-specific external storage, retrievable
without broad storage permissions:

```sh
adb shell am start -n com.mandltv.dumlprobe/.MainActivity \
  --es frames '<complete-duml-hex>[,<complete-duml-hex>]'
adb pull /sdcard/Android/data/com.mandltv.dumlprobe/files/duml-ble-probe.jsonl
```

To test only GATT reads—no DUML writes—add `--ez gattStateProbe true`. It reads FFF3,
FFF4, FFF5, and FFF7 after subscribing to FFF4 and logs the returned values.

For a recording-transition capture, add `--ez subscribeAll true` and an optional
`--ei initialDelayMilliseconds 3000`. This enables all vendor CCCDs before the first
supplied DUML write and records the source characteristic with every notification.

Add `--ez screenCodeProbe true` to show a six-colour, 100-ms tablet-screen timecode
for a frame-to-clock validation. With the camera facing the screen, decode the first
and last visible colours from the original slow-motion MP4 and match them to the
`screen-code` JSONL entries. Classify dominant hue over a screen region, not raw
brightness, because 240-fps footage can reveal tablet scanlines.

Treat `write-result` only as Android's GATT result. A command is accepted only when
a matching checksum-valid notification response has been decoded and its status is
`00`. Do not commit its JSONL output: it can include device identifiers and raw
camera state.
