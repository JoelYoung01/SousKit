import { fetchPasskeyLoginOptions, verifyPasskeyLogin } from "@/api/passkeys";
import { PASSKEY_READY_KEY, getPasskey, passkeysSupported } from "@/lib/passkeys";
import { secureStorage } from "@/lib/secure-storage";
import { useSessionStore } from "@/stores/session";
import { render, screen, waitFor } from "@testing-library/react-native";
import { PasskeyLoginButton } from "../PasskeyLoginButton";

jest.mock("@/lib/passkeys", () => ({
  PASSKEY_READY_KEY: "souskit.passkey_ready",
  passkeysSupported: jest.fn(() => true),
  getPasskey: jest.fn(),
  isPasskeyCancel: (error: unknown) =>
    error instanceof Error && /cancel/i.test(`${error.name} ${error.message}`)
}));

jest.mock("@/api/passkeys", () => ({
  fetchPasskeyLoginOptions: jest.fn(),
  verifyPasskeyLogin: jest.fn()
}));

jest.mock("@/lib/secure-storage", () => ({
  secureStorage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn()
  }
}));

const mockedSupport = passkeysSupported as jest.MockedFunction<typeof passkeysSupported>;
const mockedGet = getPasskey as jest.MockedFunction<typeof getPasskey>;
const mockedOptions = fetchPasskeyLoginOptions as jest.MockedFunction<
  typeof fetchPasskeyLoginOptions
>;
const mockedVerify = verifyPasskeyLogin as jest.MockedFunction<typeof verifyPasskeyLogin>;
const mockedStorage = secureStorage as jest.Mocked<typeof secureStorage>;

const user = {
  id: 1,
  username: "ada@example.com",
  email: "ada@example.com",
  display_name: "Ada",
  admin: false,
  disabled: false,
  email_verified: true
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSupport.mockReturnValue(true);
  mockedStorage.get.mockResolvedValue(null);
  mockedStorage.set.mockResolvedValue(undefined);
  useSessionStore.setState({
    status: "anon",
    token: null,
    user: null,
    reauthWithPasskey: true
  });
});

describe("PasskeyLoginButton", () => {
  it("hides itself when passkeys are unavailable", async () => {
    mockedSupport.mockReturnValue(false);
    await render(
      <PasskeyLoginButton onPendingChange={jest.fn()} onError={jest.fn()} autoPrompt />
    );
    expect(screen.queryByText("Sign in with Face ID")).toBeNull();
    expect(mockedOptions).not.toHaveBeenCalled();
  });

  it("auto-prompts Face ID only after the session expired and a passkey is saved", async () => {
    mockedStorage.get.mockImplementation(async (key) =>
      key === PASSKEY_READY_KEY ? "1" : null
    );
    mockedOptions.mockResolvedValue({ challenge: "abc" });
    mockedGet.mockResolvedValue({ id: "cred" } as never);
    mockedVerify.mockResolvedValue({ access_token: "session", user });

    await render(
      <PasskeyLoginButton onPendingChange={jest.fn()} onError={jest.fn()} autoPrompt />
    );

    await waitFor(() => expect(useSessionStore.getState().status).toBe("authed"));
    expect(mockedGet).toHaveBeenCalledWith({ challenge: "abc" });
    expect(useSessionStore.getState().token).toBe("session");
    expect(useSessionStore.getState().reauthWithPasskey).toBe(false);
  });

  it("does not auto-prompt on a normal visit to login", async () => {
    mockedStorage.get.mockResolvedValue("1");
    await render(
      <PasskeyLoginButton onPendingChange={jest.fn()} onError={jest.fn()} autoPrompt={false} />
    );
    expect(screen.getByText("Sign in with Face ID")).toBeOnTheScreen();
    expect(mockedOptions).not.toHaveBeenCalled();
  });

  it("stays quiet when the user cancels Face ID", async () => {
    const onError = jest.fn();
    mockedStorage.get.mockResolvedValue("1");
    mockedOptions.mockResolvedValue({ challenge: "abc" });
    mockedGet.mockRejectedValue(Object.assign(new Error("nope"), { name: "UserCancelledException" }));

    await render(<PasskeyLoginButton onPendingChange={jest.fn()} onError={onError} autoPrompt />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe("anon");
  });
});
