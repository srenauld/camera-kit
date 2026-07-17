# React Native camera transport

`@mandltv/camera-react-native` adapts an app-owned `BleManager` from
`react-native-ble-plx`. Camera protocols are injected separately so the
platform transport does not decide which cameras an application supports.

```ts
const manager = new BleManager();
const clock = { now: () => performance.now() };
const discovery = createBleCameraDiscovery({
  ble: new ReactNativeBleHandler(manager),
  drivers: [
    createDjiOsmoNanoDriver({ clock }),
    createGoproHero11Driver({ clock }),
  ] as const,
});
const kit = createCameraKit(discovery);

for await (const discovered of kit.discover({ timeoutMs: 10_000 })) {
  const camera = await discovered.connect();
  try {
    await camera.setup(camera.getCapabilities().modes[0]!);
    await camera.record();
    await camera.stop();
  } finally {
    await camera.close();
  }
}

await kit.close();
manager.destroy();
```

## Lifecycle ownership

- `BleManager` belongs to the application. Neither the handler nor CameraKit
  destroys it.
- `ReactNativeBleHandler` owns native scans and BLE connections it creates.
- CameraKit owns its discovery source and every camera session opened through
  its discovery results.
- A camera session is fully connected when `connect()` resolves. Call
  `camera.close()` when finished; it is safe to call more than once.
- `kit.close()` aborts active discoveries, closes sessions, and closes the BLE
  handler. Call it before `manager.destroy()`.
- An unexpected BLE disconnect moves the session to `disconnected`. Close that
  session and reconnect through the original discovery result.

## Native setup

- Android 12+: declare and request `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT`.
  Android 11 and earlier additionally need the applicable location permission.
- iOS: include `NSBluetoothAlwaysUsageDescription`; add the `bluetooth-central`
  background mode when control must continue in the background.
- GoPro: enable pairing mode for the one-time pairing flow and disconnect Quik.
- DJI: power on the camera and disconnect DJI Mimo before BLE control.

## Device E2E harness

The isolated E2E app lives in `e2e/` and is invoked with:

```sh
yarn e2e:dji:android
yarn e2e:dji:ios
```
