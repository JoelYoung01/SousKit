import { secureStorage } from "@/lib/secure-storage";
import {
  APP_LOCK_GRACE_MS,
  resetAppLockBootstrapForTests,
  useAppLockStore
} from "../app-lock";

jest.mock("@/lib/secure-storage", () => ({
  secureStorage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn()
  }
}));

const mockedStorage = secureStorage as jest.Mocked<typeof secureStorage>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  resetAppLockBootstrapForTests();
  useAppLockStore.setState({ ready: false, enabled: false, locked: false, leftAt: null });
  mockedStorage.get.mockResolvedValue(null);
});

describe("app lock store", () => {
  it("bootstraps unlocked when the preference is absent", async () => {
    await useAppLockStore.getState().bootstrap();
    expect(useAppLockStore.getState()).toMatchObject({
      ready: true,
      enabled: false,
      locked: false,
      leftAt: null
    });
  });

  it("bootstraps unlocked when enabled but still within the grace period", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    mockedStorage.get.mockImplementation(async (key) => {
      if (key === "souskit.app_lock") return "1";
      if (key === "souskit.app_lock.left_at") return String(now - 30 * 60 * 1000);
      return null;
    });

    await useAppLockStore.getState().bootstrap();
    expect(useAppLockStore.getState()).toMatchObject({
      ready: true,
      enabled: true,
      locked: false
    });
  });

  it("bootstraps locked when enabled and the grace period has elapsed", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    mockedStorage.get.mockImplementation(async (key) => {
      if (key === "souskit.app_lock") return "1";
      if (key === "souskit.app_lock.left_at") return String(now - APP_LOCK_GRACE_MS);
      return null;
    });

    await useAppLockStore.getState().bootstrap();
    expect(useAppLockStore.getState()).toMatchObject({
      ready: true,
      enabled: true,
      locked: true
    });
  });

  it("bootstraps unlocked when enabled but there is no left-at timestamp", async () => {
    mockedStorage.get.mockImplementation(async (key) =>
      key === "souskit.app_lock" ? "1" : null
    );
    await useAppLockStore.getState().bootstrap();
    expect(useAppLockStore.getState()).toMatchObject({
      enabled: true,
      locked: false,
      leftAt: null
    });
  });

  it("only bootstraps once", async () => {
    await useAppLockStore.getState().bootstrap();
    await useAppLockStore.getState().bootstrap();
    // Preference + left-at keys on the first bootstrap only.
    expect(mockedStorage.get).toHaveBeenCalledTimes(2);
  });

  it("persists the preference when enabling, without locking the current session", async () => {
    await useAppLockStore.getState().setEnabled(true);
    expect(mockedStorage.set).toHaveBeenCalledWith("souskit.app_lock", "1");
    expect(mockedStorage.remove).toHaveBeenCalledWith("souskit.app_lock.left_at");
    expect(useAppLockStore.getState()).toMatchObject({
      enabled: true,
      locked: false,
      leftAt: null
    });
  });

  it("removes the preference when disabling", async () => {
    await useAppLockStore.getState().setEnabled(true);
    await useAppLockStore.getState().setEnabled(false);
    expect(mockedStorage.remove).toHaveBeenCalledWith("souskit.app_lock");
    expect(mockedStorage.remove).toHaveBeenCalledWith("souskit.app_lock.left_at");
    expect(useAppLockStore.getState()).toMatchObject({
      enabled: false,
      locked: false,
      leftAt: null
    });
  });

  it("markBackgrounded records leftAt only while enabled", () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);

    useAppLockStore.getState().markBackgrounded();
    expect(mockedStorage.set).not.toHaveBeenCalled();
    expect(useAppLockStore.getState().leftAt).toBeNull();

    useAppLockStore.setState({ enabled: true });
    useAppLockStore.getState().markBackgrounded();
    expect(mockedStorage.set).toHaveBeenCalledWith("souskit.app_lock.left_at", String(now));
    expect(useAppLockStore.getState().leftAt).toBe(now);
    expect(useAppLockStore.getState().locked).toBe(false);
  });

  it("resume locks after the grace period and resets the timer when returning early", () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    useAppLockStore.setState({ enabled: true });

    useAppLockStore.getState().markBackgrounded();
    jest.spyOn(Date, "now").mockReturnValue(now + 30 * 60 * 1000);
    useAppLockStore.getState().resume();
    expect(useAppLockStore.getState()).toMatchObject({ locked: false, leftAt: null });
    expect(mockedStorage.remove).toHaveBeenCalledWith("souskit.app_lock.left_at");

    // Next background starts a fresh hour; returning after another hour locks.
    const leftAgain = now + 40 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(leftAgain);
    useAppLockStore.getState().markBackgrounded();
    jest.spyOn(Date, "now").mockReturnValue(leftAgain + APP_LOCK_GRACE_MS);
    useAppLockStore.getState().resume();
    expect(useAppLockStore.getState().locked).toBe(true);
  });

  it("lock() engages only while enabled", async () => {
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().locked).toBe(false);

    await useAppLockStore.getState().setEnabled(true);
    useAppLockStore.getState().lock();
    expect(useAppLockStore.getState().locked).toBe(true);

    useAppLockStore.getState().unlock();
    expect(useAppLockStore.getState()).toMatchObject({ locked: false, leftAt: null });
    expect(mockedStorage.remove).toHaveBeenCalledWith("souskit.app_lock.left_at");
  });
});
