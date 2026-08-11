/**
 * Guards a real CI regression: GitHub Actions passes unset vars through as
 * empty strings, and the web app's API_URL variable is the relative `/api` —
 * neither may end up as the native app's API base URL.
 */

declare let global: { __DEV__: boolean };

function loadConfig(envValue: string | undefined, dev: boolean) {
  let config: typeof import("../config");
  const prevEnv = process.env.EXPO_PUBLIC_API_URL;
  const prevDev = global.__DEV__;
  if (envValue === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = envValue;
  global.__DEV__ = dev;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per env permutation
    config = require("../config");
  });
  process.env.EXPO_PUBLIC_API_URL = prevEnv;
  global.__DEV__ = prevDev;
  return config!;
}

describe("API_URL resolution", () => {
  it("ignores an empty env value (unset CI var)", () => {
    expect(loadConfig("", false).API_URL).toBe("https://sous-kit.com/api");
    expect(loadConfig("", true).API_URL).toBe("http://localhost:8000/api");
  });

  it("ignores a relative env value (web app's /api)", () => {
    expect(loadConfig("/api", false).API_URL).toBe("https://sous-kit.com/api");
  });

  it("uses an absolute env value as-is", () => {
    const cfg = loadConfig("https://staging.example.dev/api", false);
    expect(cfg.API_URL).toBe("https://staging.example.dev/api");
    expect(cfg.API_ORIGIN).toBe("https://staging.example.dev");
  });
});
