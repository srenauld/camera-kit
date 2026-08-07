import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packages = path.dirname(fileURLToPath(import.meta.url));
const jest = path.join(packages, "..", "node_modules", ".bin", "jest");
const config = path.join(packages, "jest.combined.config.cjs");

function runJest(selectProjects, { coverage = false, runInBand = false, detectOpenHandles = false } = {}) {
  const args = ["--config", config];

  if (runInBand) args.push("--runInBand");

  if (detectOpenHandles) args.push("--detectOpenHandles");

  if (selectProjects.length > 0) {
    args.push("--selectProjects", ...selectProjects);
  }
  if (coverage) args.push("--coverage");

  return spawnSync(jest, args, {
    cwd: packages,
    stdio: "inherit",
    env: process.env,
  });
}

const unitProjects = [
  "camera-core",
  "camera-dji",
  "camera-gopro",
  "camera-macos",
  "camera-react-native",
];

// Keep the coverage run separate from application-level suites. Integration and
// E2E tests bootstrap the whole Nest application and otherwise retain their
// instrumented module graph alongside all unit-test projects in one process.
// The native BLE test doubles and coverage instrumentation can leave a Jest
// worker waiting for the event loop to drain on CI runners. Running the
// combined suite in-band keeps teardown deterministic without masking test
// failures or using --forceExit.
let result = runJest(unitProjects, { coverage: true, runInBand: true, detectOpenHandles: true });
if (result.status !== 0) process.exit(result.status ?? 1);

for (const project of ["integration", "e2e"]) {
  const flag = project === "integration" ? "RUN_INTEGRATION" : "RUN_E2E";
  if (process.env[flag] !== "1") {
    continue;
  }

  result = runJest([project], { runInBand: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
