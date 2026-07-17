const path = require("node:path");

const backendRoot = __dirname;

function unitProject(displayName, directory, moduleNameMapper) {
  return {
    displayName,
    rootDir: path.join(backendRoot, directory),
    moduleFileExtensions: ["js", "json", "ts"],
    testRegex: ".*\\.(test|spec)\\.ts$",
    transform: { "^.+\\.(t|j)s$": "ts-jest" },
    moduleNameMapper,
    testEnvironment: "node",
    collectCoverageFrom: ["src/**/*.(t|j)s"],
  };
}

const projects = [
  unitProject("camera-core", "camera-core"),
  unitProject("camera-gopro", "camera-gopro"),
  unitProject("camera-dji", "camera-dji"),
  unitProject("camera-macos", "camera-macos"),
  unitProject("camera-react-native", "camera-react-native")
];

if (process.env.RUN_INTEGRATION === "1") {
  projects.push({
    displayName: "integration",
    rootDir: path.join(backendRoot, "service"),
    moduleFileExtensions: ["js", "json", "ts"],
    testRegex: "test/subscription-repositories\\.e2e-spec\\.ts$",
    transform: { "^.+\\.(t|j)s$": "ts-jest" },
    moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
    testEnvironment: "node",
    collectCoverageFrom: ["src/**/*.(t|j)s"],
  });
}

if (process.env.RUN_E2E === "1") {
  projects.push({
    displayName: "e2e",
    rootDir: path.join(backendRoot, "service"),
    moduleFileExtensions: ["js", "json", "ts"],
    testRegex: "test/app\\.e2e-spec\\.ts$",
    transform: { "^.+\\.(t|j)s$": "ts-jest" },
    moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
    testEnvironment: "node",
    maxWorkers: 1,
    collectCoverageFrom: ["src/**/*.(t|j)s"],
  });
}

module.exports = {
  projects,
  coverageDirectory: path.join(backendRoot, "coverage/combined"),
  collectCoverageFrom: ["**/src/**/*.{ts,js,jsx,tsx}"],
  coverageReporters: ["text", "text-summary", "json", "lcov"],
  coverageThreshold: {
    global: { branches: 45, functions: 55, lines: 70, statements: 70 },
  },
};
