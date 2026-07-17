import { CheckStatus } from "./commands/check-status";
import { SetCameraFPS } from "./commands/set-camera-fps";
import { SetPairingComplete } from "./commands/set-pairing-complete";
import { SetResolution } from "./commands/set-resolution";
import { SetShutter } from "./commands/set-shutter";
import { SetVideoLens } from "./commands/set-video-lens";
import { GoProFrameRate } from "./delegates/types";

function channels(response = new Uint8Array([0, 0])) {
  const write = jest.fn(async () => response);
  return { command: { write }, settings: { write } } as any;
}

test("encodes the GoPro BLE setting commands and handles status responses", async () => {
  const active = channels(new Uint8Array([0, 0]));
  await expect(new CheckStatus().execute(active)).resolves.toBe(true);
  await expect(new SetPairingComplete().execute(active)).resolves.toBe(true);
  await expect(new SetShutter(true).execute(active)).resolves.toBe(true);
  await expect(new SetVideoLens("wide").execute(active)).resolves.toBe(true);
  await expect(new SetResolution("4k", "16:9").execute(active)).resolves.toBe(
    true,
  );
  await expect(
    new SetCameraFPS(GoProFrameRate.FPS30).execute(active),
  ).resolves.toBe(true);
  expect(active.settings.write).toHaveBeenCalled();
  expect(active.command.write).toHaveBeenCalledWith(new Uint8Array([0x3c]), {
    timeoutMs: 10_000,
  });

  const rejected = channels(new Uint8Array([0, 1]));
  await expect(new CheckStatus().execute(rejected)).resolves.toBe(false);
  await expect(new SetShutter(false).execute(active)).resolves.toBe(true);
  await expect(new SetPairingComplete().execute(rejected)).rejects.toThrow(
    "pairing completion",
  );
  await expect(new SetVideoLens("wide").execute(active)).resolves.toBe(true);
  await expect(new SetResolution("4k", "16:9").execute(active)).resolves.toBe(
    true,
  );
  await expect(
    new SetCameraFPS(GoProFrameRate.FPS30).execute(active),
  ).resolves.toBe(true);
});

test("rejects unsupported GoPro setting values", async () => {
  const value = channels();
  await expect(
    new SetVideoLens("invalid" as any).execute(value),
  ).rejects.toThrow("Unknown");
  await expect(
    new SetResolution("invalid" as any, "16:9").execute(value),
  ).rejects.toThrow("Unknown");
  await expect(
    new SetCameraFPS("invalid" as any).execute(value),
  ).rejects.toThrow("Unknown");
});
