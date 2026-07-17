import { expect, test } from "@jest/globals";
import { findDjiOsmoNano } from "@mandltv/camera-dji";

import { NobleScanner } from "../../src/public";

const e2e = process.env.DJI_E2E === "1" ? test : test.skip;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Real hardware only. This deliberately does not join camera Wi-Fi: v1 control is
 * BLE-only. Run with DJI_E2E=1 while the Osmo Nano is powered on and DJI Mimo is not
 * connected to it.
 */
e2e("controls an Osmo Nano over BLE and resolves record at the 81 active edge", async () => {
  const scanner = new NobleScanner();
  let camera: Awaited<ReturnType<typeof findDjiOsmoNano>> | undefined;

  try {
    camera = await findDjiOsmoNano(scanner, {
      clock: { now: () => performance.now() },
    });
    await camera.setup({
      family: "slow-motion",
      resolution: "1080p",
      aspectRatio: "16:9",
      frameRate: 240,
      slowMotionFactor: 8,
    });
    await camera.setup({
      family: "video",
      resolution: "4k",
      aspectRatio: "16:9",
      frameRate: 60,
      stabilization: "off",
    });

    const started = await camera.record();
    expect(Number.isFinite(started.recordingActiveAt)).toBe(true);
    await sleep(2_000);
    await camera.stop();
  } finally {
    await camera?.close();
    await scanner.close();
  }
}, 40_000);
