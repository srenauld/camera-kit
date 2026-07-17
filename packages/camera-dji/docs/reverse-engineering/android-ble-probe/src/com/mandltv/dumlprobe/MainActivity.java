package com.mandltv.dumlprobe;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.graphics.Color;
import android.view.View;
import android.view.WindowManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Locale;
import java.util.Queue;
import java.util.UUID;

/**
 * Deliberately small evidence probe.  It never invents packets: callers provide
 * complete checksum-valid DUML frames through the "frames" intent extra, comma
 * separated hex. Results are JSONL on shared storage for adb retrieval.
 */
public final class MainActivity extends Activity {
  private static final UUID SERVICE = uuid("0000fff0-0000-1000-8000-00805f9b34fb");
  private static final UUID NOTIFY = uuid("0000fff4-0000-1000-8000-00805f9b34fb");
  private static final UUID WRITE = uuid("0000fff5-0000-1000-8000-00805f9b34fb");
  private static final UUID AUXILIARY_1 = uuid("0000fff3-0000-1000-8000-00805f9b34fb");
  private static final UUID AUXILIARY_2 = uuid("0000fff7-0000-1000-8000-00805f9b34fb");
  private static final UUID CCCD = uuid("00002902-0000-1000-8000-00805f9b34fb");
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Queue<byte[]> frames = new ArrayDeque<>();
  private BluetoothLeScanner scanner;
  private BluetoothGatt gatt;
  private BluetoothGattCharacteristic writeCharacteristic;
  private final Runnable scanTimeout = () -> fail(new IllegalStateException("camera not found within 20 seconds"));
  private Writer rawOut;
  private boolean finished;
  private int writeCount;
  private int pauseAfter;
  private int pauseMilliseconds;
  private boolean gattStateProbe;
  private boolean subscribeAll;
  private boolean toneStateProbe;
  private boolean screenStateProbe;
  private boolean screenCodeProbe;
  private int initialDelayMilliseconds;
  private final Queue<BluetoothGattCharacteristic> readCharacteristics = new ArrayDeque<>();
  private final Queue<BluetoothGattDescriptor> subscriptionDescriptors = new ArrayDeque<>();
  private volatile boolean tonePlaying;
  private volatile int toneHz = 2500;
  private AudioTrack toneTrack;
  private Thread toneThread;
  private View stateScreen;
  private int screenCodeIndex;
  private final int[] screenCodeColors = new int[]{Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW, Color.MAGENTA, Color.CYAN};
  private final String[] screenCodeNames = new String[]{"red", "green", "blue", "yellow", "magenta", "cyan"};
  private final Runnable screenCodeTick = new Runnable() {
    @Override public void run() {
      if (!screenCodeProbe || finished) return;
      int index = screenCodeIndex++ % screenCodeColors.length;
      stateScreen.setBackgroundColor(screenCodeColors[index]);
      event("screen-code", "color", screenCodeNames[index]);
      handler.postDelayed(this, 100);
    }
  };

  private static UUID uuid(String value) { return UUID.fromString(value); }
  private static String hex(byte[] data) {
    StringBuilder value = new StringBuilder(data.length * 2);
    for (byte b : data) value.append(String.format(Locale.ROOT, "%02x", b & 0xff));
    return value.toString();
  }
  private static byte[] unhex(String value) {
    if ((value.length() & 1) != 0 || !value.matches("[0-9a-fA-F]+")) throw new IllegalArgumentException("invalid hex");
    byte[] result = new byte[value.length() / 2];
    for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
    return result;
  }
  private static int reflectedCrc(byte[] bytes, int initial, int polynomial, int width) {
    int crc = initial;
    int mask = (1 << width) - 1;
    for (byte value : bytes) {
      crc ^= value & 0xff;
      for (int bit = 0; bit < 8; bit++) crc = (crc & 1) != 0 ? (crc >>> 1) ^ polynomial : crc >>> 1;
    }
    return crc & mask;
  }
  private static boolean validDuml(byte[] data) {
    if (data.length < 13 || data[0] != 0x55 || (data[1] | ((data[2] & 3) << 8)) != data.length) return false;
    int crc8 = reflectedCrc(Arrays.copyOfRange(data, 0, 3), 0x77, 0x8c, 8);
    int crc16 = reflectedCrc(Arrays.copyOfRange(data, 0, data.length - 2), 0x3692, 0x8408, 16);
    int stored = (data[data.length - 2] & 0xff) | ((data[data.length - 1] & 0xff) << 8);
    return crc8 == (data[3] & 0xff) && crc16 == stored;
  }

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    try {
      String supplied = getIntent().getStringExtra("frames");
      pauseAfter = getIntent().getIntExtra("pauseAfter", -1);
      pauseMilliseconds = getIntent().getIntExtra("pauseMilliseconds", 5000);
      gattStateProbe = getIntent().getBooleanExtra("gattStateProbe", false);
      subscribeAll = getIntent().getBooleanExtra("subscribeAll", false);
      toneStateProbe = getIntent().getBooleanExtra("toneStateProbe", false);
      screenStateProbe = getIntent().getBooleanExtra("screenStateProbe", false);
      screenCodeProbe = getIntent().getBooleanExtra("screenCodeProbe", false);
      if (screenStateProbe || screenCodeProbe) {
        stateScreen = new View(this);
        setContentView(stateScreen);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        setScreenColor(Color.RED, "baseline");
      }
      initialDelayMilliseconds = getIntent().getIntExtra("initialDelayMilliseconds", 0);
      if (supplied != null && !supplied.isEmpty()) for (String value : supplied.split(",")) {
        byte[] frame = unhex(value);
        if (!validDuml(frame)) throw new IllegalArgumentException("frame is not complete DUML");
        frames.add(frame);
      }
      File file = new File(getExternalFilesDir(null), "duml-ble-probe.jsonl");
      rawOut = new OutputStreamWriter(new FileOutputStream(file, false), StandardCharsets.UTF_8);
      event("started", "output", file.getAbsolutePath());
      if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED ||
          checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.ACCESS_FINE_LOCATION}, 1);
      } else start();
    } catch (Exception error) { fail(error); }
  }
  @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(request, permissions, results);
    if (request != 1 || Arrays.stream(results).anyMatch(v -> v != PackageManager.PERMISSION_GRANTED)) fail(new SecurityException("Bluetooth permissions denied")); else start();
  }
  private void start() {
    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
    if (adapter == null || !adapter.isEnabled()) { fail(new IllegalStateException("Bluetooth disabled")); return; }
    scanner = adapter.getBluetoothLeScanner();
    if (scanner == null) { fail(new IllegalStateException("BLE scanner unavailable")); return; }
    event("scan-start", "wifi", "caller must have disabled Wi-Fi before launch");
    scanner.startScan(scanCallback);
    handler.postDelayed(scanTimeout, 20000);
  }
  private final ScanCallback scanCallback = new ScanCallback() {
    @Override public void onScanResult(int callbackType, ScanResult result) {
      boolean serviceMatch = result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null && result.getScanRecord().getServiceUuids().contains(new android.os.ParcelUuid(SERVICE));
      String name = result.getDevice().getName();
      event("scan-observation", "advertisement", "name=" + (name == null ? "" : name) + ";fff0=" + serviceMatch + ";rssi=" + result.getRssi());
      if (!serviceMatch && (name == null || !name.toLowerCase(Locale.ROOT).contains("osmo"))) return;
      scanner.stopScan(this);
      handler.removeCallbacks(scanTimeout);
      event("scan-match", "rssi", Integer.toString(result.getRssi()));
      gatt = result.getDevice().connectGatt(MainActivity.this, false, callback, BluetoothDevice.TRANSPORT_LE);
    }
    @Override public void onScanFailed(int code) { fail(new IllegalStateException("scan failed " + code)); }
  };
  private final BluetoothGattCallback callback = new BluetoothGattCallback() {
    @Override public void onConnectionStateChange(BluetoothGatt ignored, int status, int newState) {
      event("connection", "status", status + ":" + newState);
      if (status != BluetoothGatt.GATT_SUCCESS) { fail(new IllegalStateException("GATT connect status " + status)); return; }
      if (newState == BluetoothGatt.STATE_CONNECTED) ignored.discoverServices();
      if (newState == BluetoothGatt.STATE_DISCONNECTED) finishProbe();
    }
    @Override public void onServicesDiscovered(BluetoothGatt ignored, int status) {
      if (status != BluetoothGatt.GATT_SUCCESS) { fail(new IllegalStateException("service discovery " + status)); return; }
      BluetoothGattService service = ignored.getService(SERVICE);
      BluetoothGattCharacteristic notify = service == null ? null : service.getCharacteristic(NOTIFY);
      writeCharacteristic = service == null ? null : service.getCharacteristic(WRITE);
      if (notify == null || writeCharacteristic == null) { fail(new IllegalStateException("FFF0/FFF4/FFF5 unavailable")); return; }
      UUID[] notificationUuids = subscribeAll
          ? new UUID[]{AUXILIARY_1, NOTIFY, WRITE, AUXILIARY_2}
          : new UUID[]{NOTIFY};
      for (UUID characteristicUuid : notificationUuids) {
        BluetoothGattCharacteristic characteristic = service.getCharacteristic(characteristicUuid);
        if (characteristic == null) continue;
        int properties = characteristic.getProperties();
        if ((properties & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) == 0) continue;
        if (!ignored.setCharacteristicNotification(characteristic, true)) { fail(new IllegalStateException("notification enable rejected " + characteristicUuid)); return; }
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(CCCD);
        if (descriptor == null) { fail(new IllegalStateException("CCCD unavailable " + characteristicUuid)); return; }
        descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
        subscriptionDescriptors.add(descriptor);
      }
      if (gattStateProbe) {
        for (UUID characteristicUuid : new UUID[]{AUXILIARY_1, NOTIFY, WRITE, AUXILIARY_2}) {
          BluetoothGattCharacteristic characteristic = service.getCharacteristic(characteristicUuid);
          if (characteristic != null) readCharacteristics.add(characteristic);
        }
      }
      subscribeNext();
    }
    @Override public void onDescriptorWrite(BluetoothGatt ignored, BluetoothGattDescriptor descriptor, int status) {
      if (status != BluetoothGatt.GATT_SUCCESS) { fail(new IllegalStateException("CCCD status " + status)); return; }
      event("subscribed", "cccd", descriptor.getUuid().toString());
      subscribeNext();
    }
    @Override public void onCharacteristicChanged(BluetoothGatt ignored, BluetoothGattCharacteristic characteristic) {
      byte[] value = characteristic.getValue();
      event("notification", "frame", "characteristic=" + characteristic.getUuid() + ";value=" + hex(value));
      // The first ATT fragment of the recurring 02/80 status packet contains
      // payload byte 3.  Tone changes make the firmware state edge observable
      // in the camera's AAC track without relying on a visual marker.
      if ((toneStateProbe || screenStateProbe) && characteristic.getUuid().equals(NOTIFY) && value.length >= 15 &&
          (value[0] & 0xff) == 0x55 && (value[9] & 0xff) == 0x02 && (value[10] & 0xff) == 0x80) {
        int state = value[11] & 0xff;
        event("status-marker", "value", String.format(Locale.ROOT, "%02x", state));
        if (state == 0x81) setTone(4500, "recording-active");
        else if (state == 0xc1) setTone(6500, "stop-transition");
        else if (state == 0x01) setTone(8500, "inactive");
        if (!screenCodeProbe) {
          if (state == 0x81) setScreenColor(Color.GREEN, "recording-active");
          else if (state == 0xc1) setScreenColor(Color.BLUE, "stop-transition");
          else if (state == 0x01) setScreenColor(Color.WHITE, "inactive");
        }
      }
    }
    @Override public void onCharacteristicWrite(BluetoothGatt ignored, BluetoothGattCharacteristic characteristic, int status) {
      event("write-result", "status", Integer.toString(status));
      if (status != BluetoothGatt.GATT_SUCCESS) { fail(new IllegalStateException("FFF5 write status " + status)); return; }
      long delay = writeCount == pauseAfter ? pauseMilliseconds : 250;
      if (writeCount == pauseAfter) event("pause", "milliseconds", Long.toString(delay));
      handler.postDelayed(MainActivity.this::sendNext, delay);
    }
    @Override public void onCharacteristicRead(BluetoothGatt ignored, BluetoothGattCharacteristic characteristic, int status) {
      event("read-result", "characteristic", characteristic.getUuid() + ";status=" + status + ";value=" + hex(characteristic.getValue()));
      if (status != BluetoothGatt.GATT_SUCCESS) { finishProbe(); return; }
      readNext();
    }
  };
  private void subscribeNext() {
    BluetoothGattDescriptor descriptor = subscriptionDescriptors.poll();
    if (descriptor != null) {
      if (!gatt.writeDescriptor(descriptor)) fail(new IllegalStateException("CCCD write rejected"));
      return;
    }
    if (gattStateProbe) { readNext(); return; }
    if (toneStateProbe) startTone();
    if (screenCodeProbe) handler.post(screenCodeTick);
    if (initialDelayMilliseconds > 0) event("pause", "milliseconds", Integer.toString(initialDelayMilliseconds));
    handler.postDelayed(this::sendNext, initialDelayMilliseconds);
  }
  private synchronized void startTone() {
    if (tonePlaying) return;
    int sampleRate = 48000;
    toneTrack = new AudioTrack.Builder()
        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
        .setAudioFormat(new AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(sampleRate / 5 * 2)
        .setTransferMode(AudioTrack.MODE_STREAM).build();
    tonePlaying = true;
    toneTrack.play();
    toneThread = new Thread(() -> {
      short[] pcm = new short[480];
      double phase = 0;
      while (tonePlaying) {
        double increment = 2 * Math.PI * toneHz / sampleRate;
        for (int i = 0; i < pcm.length; i++) {
          pcm[i] = (short) (0.30 * Short.MAX_VALUE * Math.sin(phase));
          phase += increment;
          if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
        }
        toneTrack.write(pcm, 0, pcm.length);
      }
    }, "ble-state-tone");
    toneThread.start();
    event("tone", "hertz", Integer.toString(toneHz));
  }
  private void setTone(int hertz, String state) {
    if (!toneStateProbe) return;
    if (toneHz == hertz) return;
    toneHz = hertz;
    event("tone", "state", state + ";hertz=" + hertz);
  }
  private void setScreenColor(int color, String state) {
    if ((!screenStateProbe && !screenCodeProbe) || stateScreen == null) return;
    handler.post(() -> stateScreen.setBackgroundColor(color));
    event("screen", "state", state);
  }
  private void readNext() {
    BluetoothGattCharacteristic characteristic = readCharacteristics.poll();
    if (characteristic == null) { event("complete", "result", "read-only GATT probe complete"); handler.postDelayed(this::finishProbe, 1000); return; }
    event("read", "characteristic", characteristic.getUuid().toString());
    if (!gatt.readCharacteristic(characteristic)) fail(new IllegalStateException("GATT read enqueue rejected"));
  }
  private void sendNext() {
    if (finished) return;
    byte[] frame = frames.poll();
    if (frame == null) { event("complete", "result", "writes sent; notification window remains open 2s"); handler.postDelayed(this::finishProbe, 2000); return; }
    event("write", "frame", hex(frame));
    writeCount += 1;
    writeCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
    writeCharacteristic.setValue(frame);
    if (!gatt.writeCharacteristic(writeCharacteristic)) fail(new IllegalStateException("FFF5 write enqueue rejected"));
  }
  private synchronized void event(String kind, String key, String value) {
    try {
      rawOut.write("{\"monotonicMs\":" + android.os.SystemClock.elapsedRealtime() + ",\"event\":\"" + json(kind) + "\",\"" + json(key) + "\":\"" + json(value) + "\"}\n");
      rawOut.flush();
    } catch (Exception ignored) { }
  }
  private static String json(String value) { return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r"); }
  private void fail(Exception error) { if (!finished) event("error", "message", error.toString()); finishProbe(); }
  private synchronized void finishProbe() {
    if (finished) return;
    finished = true;
    try { if (scanner != null) scanner.stopScan(scanCallback); } catch (Exception ignored) {}
    handler.removeCallbacks(scanTimeout);
    handler.removeCallbacks(screenCodeTick);
    tonePlaying = false;
    try { if (toneThread != null) toneThread.join(250); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    try { if (toneTrack != null) { toneTrack.stop(); toneTrack.release(); } } catch (Exception ignored) {}
    if (gatt != null) { gatt.disconnect(); gatt.close(); }
    try { rawOut.close(); } catch (Exception ignored) {}
    finish();
  }
}
