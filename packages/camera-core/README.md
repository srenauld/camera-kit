# Camera core lifecycle

Camera core separates transport discovery from connected camera sessions.

1. A platform `BleHandler` scans immutable `BleAdvertisementPacket` snapshots.
2. `BleCameraDiscovery` matches snapshots with injected camera drivers.
3. `CameraKit.discover()` yields typed descriptors without connecting.
4. `descriptor.connect()` opens one fully initialized camera session.
5. `camera.close()` closes protocol subscriptions and disconnects its device.
6. `kit.close()` aborts discovery, closes all sessions, and closes its handler.

Only one active camera session is allowed for a transport ID. Concurrent calls
while a connection is opening share that operation; calls after it opens fail
until the session is closed. A descriptor can be reused to reconnect afterward.

`CameraKit` and `createCameraKit()` are transport-agnostic. BLE scan, matching,
and connection behavior belongs to `BleCameraDiscovery`, which is constructed
separately with `createBleCameraDiscovery()` and injected into the kit.
