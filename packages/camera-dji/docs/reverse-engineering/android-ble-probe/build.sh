#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
SDK="~/Library/Android/sdk"
TOOLS="$SDK/build-tools/36.1.0"
OUT="$ROOT/out"
KEYSTORE="$ROOT/.debug.keystore"
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/res" "$OUT/dex"
"$TOOLS/aapt2" compile --dir "$ROOT/res" -o "$OUT/res.zip"
"$TOOLS/aapt2" link -I "$SDK/platforms/android-36.1/android.jar" --manifest "$ROOT/AndroidManifest.xml" --min-sdk-version 23 --target-sdk-version 35 --auto-add-overlay -o "$OUT/unsigned.apk" "$OUT/res.zip"
javac -source 11 -target 11 -classpath "$SDK/platforms/android-36.1/android.jar:$OUT/unsigned.apk" -d "$OUT/classes" "$ROOT/src/com/mandltv/dumlprobe/MainActivity.java"
"$TOOLS/d8" --lib "$SDK/platforms/android-36.1/android.jar" --output "$OUT/dex" "$OUT/classes/com/mandltv/dumlprobe/"*.class
(cd "$OUT/dex" && zip -q -u "$OUT/unsigned.apk" classes.dex)
if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=DUML Probe" >/dev/null 2>&1
fi
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --out "$OUT/duml-ble-probe.apk" "$OUT/unsigned.apk"
echo "$OUT/duml-ble-probe.apk"
