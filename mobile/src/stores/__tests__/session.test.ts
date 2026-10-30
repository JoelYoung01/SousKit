import { checkSessionToken } from "@/api/auth";
import { secureStorage } from "@/lib/secure-storage";
import type { UserResponse } from "@/types";
import { resetSessionBootstrapForTests, useSessionStore } from "../session";

jest.mock("@/lib/secure-storage", () => ({
  secureStorage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn()
  }
}));

jest.mock("@/api/auth", () => ({
  checkSessionToken: jest.fn()
}));

const mockedStorage = secureStorage as jest.Mocked<typeof secureStorage>;
const mockedCheck = checkSessionToken as jest.MockedFunction<typeof checkSessionToken>;

const user = {
  id: 1,
  username: "ada@example.com",
  email: "ada@example.com",
  display_name: "Ada",
  admin: false,
  disabled: false,
  email_verified: true
} as UserResponse;

const memory = new Map<string, string>();

beforeEach(() => {
  jest.clearAllMocks();
  memory.clear();
  resetSessionBootstrapForTests();
  useSessionStore.setState({
    status: "loading",
    token: null,
    user: null,
    reauthWithPasskey: false
  });
  mockedStorage.get.mockImplementation(async (key) => memory.get(key) ?? null);
  mockedStorage.set.mockImplementation(async (key, value) => {
    memory.set(key, value);
  });
  mockedStorage.remove.mockImplementation(async (key) => {
    memory.delete(key);
  });
});

describe("session idle window", () => {
  it("bootstraps signed out when nothing is stored", async () => {
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState()).toMatchObject({
      status: "anon",
      token: null,
      reauthWithPasskey: false
    });
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("stores the refreshed token and does not ask for a passkey", async () => {
    memory.set("souskit.access_token", "old-token");
    mockedCheck.mockResolvedValue({ access_token: "fresh-token", user });

    await useSessionStore.getState().bootstrap();

    expect(mockedCheck).toHaveBeenCalledWith("old-token");
    expect(memory.get("souskit.access_token")).toBe("fresh-token");
    expect(useSessionStore.getState()).toMatchObject({
      status: "authed",
      token: "fresh-token",
      reauthWithPasskey: false
    });
  });

  it("keeps the session when the server cannot be reached", async () => {
    memory.set("souskit.access_token", "old-token");
    memory.set("souskit.session_user", JSON.stringify(user));
    mockedCheck.mockRejectedValue(new Error("offline"));

    await useSessionStore.getState().bootstrap();

    expect(useSessionStore.getState()).toMatchObject({
      status: "authed",
      token: "old-token",
      reauthWithPasskey: false
    });
    expect(memory.get("souskit.access_token")).toBe("old-token");
  });

  it("marks passkey reauth when the server rejects the session", async () => {
    memory.set("souskit.access_token", "old-token");
    mockedCheck.mockResolvedValue(null);

    await useSessionStore.getState().bootstrap();

    expect(useSessionStore.getState()).toMatchObject({
      status: "anon",
      token: null,
      reauthWithPasskey: true
    });
    expect(memory.get("souskit.reauth_with_passkey")).toBe("1");
    expect(memory.has("souskit.access_token")).toBe(false);
  });

  it("remembers a rejected session across a later cold start", async () => {
    memory.set("souskit.reauth_with_passkey", "1");
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().reauthWithPasskey).toBe(true);
  });

  it("refreshes on use and collapses a second touch in the same moment", async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    mockedCheck.mockResolvedValue({ access_token: "once", user });
    await useSessionStore.getState().setSession("once", user);
    mockedCheck.mockClear();

    // Past the short duplicate-resume gap, but still the same visit.
    jest.spyOn(Date, "now").mockReturnValue(now + 6_000);
    let release: (value: { access_token: string; user: UserResponse }) => void = () => {};
    mockedCheck.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const first = useSessionStore.getState().touch();
    const second = useSessionStore.getState().touch();
    release({ access_token: "twice", user });
    await Promise.all([first, second]);

    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().token).toBe("twice");

    mockedCheck.mockClear();
    await useSessionStore.getState().touch();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("sign-out does not arm the passkey prompt", async () => {
    memory.set("souskit.reauth_with_passkey", "1");
    await useSessionStore.getState().setSession("token", user);
    await useSessionStore.getState().clear();
    expect(useSessionStore.getState()).toMatchObject({
      status: "anon",
      reauthWithPasskey: false
    });
    expect(memory.has("souskit.reauth_with_passkey")).toBe(false);
  });

  it("only bootstraps once", async () => {
    await useSessionStore.getState().bootstrap();
    memory.set("souskit.access_token", "later");
    await useSessionStore.getState().bootstrap();
    expect(mockedCheck).not.toHaveBeenCalled();
  });
});
