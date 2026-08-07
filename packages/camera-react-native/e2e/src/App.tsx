import {
  createBleCameraDiscovery,
  createCameraKit,
} from "@mandltv/camera-core";
import { createDjiOsmoNanoDriver, DjiFrameRate } from "@mandltv/camera-dji";
import { createGoproHero11Driver } from "@mandltv/camera-gopro";
import { ReactNativeBleHandler } from "@mandltv/camera-react-native";
import { useCallback, useState } from "react";
import { Button, PermissionsAndroid, Platform, Text, View } from "react-native";
import { BleManager } from "react-native-ble-plx";
import { SafeAreaView } from "react-native-safe-area-context";

const manager = new BleManager();
const target = process.env.CAMERA_E2E_TARGET ?? "dji";

export default function App() {
  const [status, setStatus] = useState("Ready");

  const run = useCallback(async () => {
    const discovery = createBleCameraDiscovery({
      ble: new ReactNativeBleHandler(manager),
      drivers: [createDjiOsmoNanoDriver(), createGoproHero11Driver()] as const,
    });
    const kit = createCameraKit(discovery);
    try {
      if (Platform.OS === "android" && Platform.Version >= 31) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
      }

      setStatus("Scanning");
      let found = false;
      for await (const discovered of kit.discover({ timeoutMs: 10_000 })) {
        found = true;
        const camera = await discovered.connect();
        try {
          setStatus(`Found ${camera.model}`);
          if (camera.kind === "dji-osmo-nano") {
            const mode =
              camera
                .getCapabilities()
                .modes.find(
                  (candidate) =>
                    candidate.resolution === "4k" &&
                    candidate.frameRate === DjiFrameRate.FPS60,
                ) ?? camera.getCapabilities().modes[0];
            await camera.setup(mode);
          } else {
            await camera.setup(camera.getCapabilities().modes[0]);
          }
          await camera.record();
          setStatus("Recording");
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await camera.stop();
          setStatus("Passed");
        } finally {
          await camera.close();
        }
        break;
      }
      if (!found) throw new Error("No camera found");
    } catch (error) {
      setStatus(
        `Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await kit.close();
    }
  }, []);

  return (
    <SafeAreaView>
      <View>
        <Text accessibilityLabel="camera-e2e-status">{status}</Text>
        <Button
          accessibilityLabel={`run-${target}-ble-test`}
          onPress={() => {
            void run();
          }}
          title={`Run ${target.toUpperCase()} BLE test`}
        />
      </View>
    </SafeAreaView>
  );
}
