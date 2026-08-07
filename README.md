# Why?

I commute a lot by bicycle, and on a number of occasions, I wish I had turned on the cameras before cycling. Unfortunately, with *any* setup, this requires multiple operations, and I've had both the GoPro and DJI Osmo cameras I have randomly lose BLE connection and stop recording. Being locked to your camera manufacturer's app kinda sucks.

Simultaneously, I had a need to *accurately* track, record and preview data at high frame rates in a fixed reference frame for archery. To do this without automating a camera, I would need to manually do time synchronization.

So, I just set out and reverse-engineered the protocols for both cameras, and built a neat abstraction over them.

# Compatibility

Supported camera models:
1. DJI Osmo Nano (but in theory this also works for Action and Pocket cameras. If you have one of these/would like to send me one of these, I'd be interested to test it).
2. GoPro Hero 11.

The protocol for GoPro cameras should be compatible with Hero 8, 9, 10, 12 and 13, but I have no hardware to verify it. I have opted to strictly verify what I have here rather than make wild promises on compatibility; if you have a camera you wish to lend, feel free to!

# Usage

Create a kit:

```ts
const manager = new BleManager();
const discovery = createBleCameraDiscovery({
  ble: new ReactNativeBleHandler(manager),
  drivers: [
    createDjiOsmoNanoDriver(), 
    createGoproHero11Driver()
  ] as const,
});
const kit = createCameraKit(discovery);
```

Injected drivers define what devices you can access/interface with. The `ble` object is the actual transport/platform-specific abstraction. In this case, we're working with React Native.

This **does not** handle permissions for you.

Once you have handled permissions and created this object, you can use `discover()` to listen for BLE advertisement packets that map to a known/operable device.

```ts
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
```

You can change the camera's modes with `setup()`, list its capabilities with `getCapabilities()`, enable preview and stream video frames (soon)...

An example is kept up to date in `camera-react-native` and `camera-macos`. They function as e2e tests.

# Contributing

## Camera abstractions

If they're the same make as one of the other packages, extend it with a specific protocol handler; if not, create a package.

Packages need to have a working protocol implementation and a working e2e test suite. If in doubt, use `camera-react-native` (`react-native-ble-plx` is significantly more stable than `noble`).

## Features

Land a PR and I'll look at it. Bear in mind that this is a side project of a side project (I built this as a solution to a small problem on two applications), and the scope and abstractions is designed to be small.

In theory, this can do more than camera hardware relatively easily.