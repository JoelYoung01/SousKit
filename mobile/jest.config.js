const expoPreset = require("jest-expo/jest-preset");

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  transform: {
    ...expoPreset.transform,
    // jest-expo only transforms .js/.ts/.tsx; ESM-only packages resolved via
    // the "react-native" exports condition (e.g. lucide) ship .mjs files.
    "\\.mjs$": expoPreset.transform["\\.[jt]sx?$"],
  },
  moduleNameMapper: {
    // Keep the more specific assets alias above the catch-all (tsconfig parity).
    "^@/assets/(.*)$": "<rootDir>/assets/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css)$": "<rootDir>/test/css-stub.js",
  },
  setupFiles: ["<rootDir>/test/setup.ts"],
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|standard-navigation|nativewind|react-native-css-interop|lucide-react-native|react-native-keyboard-controller))",
  ],
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
};
