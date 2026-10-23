import { fetchGroceryList, fetchGrocerySummary } from "@/api/grocery";
import { doFetch } from "@/api/client";
import {
  resetGroceryWindowHydrateForTests,
  useGroceryWindowStore
} from "@/hooks/use-grocery";
import { GROCERY_WINDOW_OPTIONS } from "@/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/api/client", () => ({
  doFetch: jest.fn(),
  get: jest.fn((url: string) => {
    const mockClient = jest.requireMock<{ doFetch: jest.Mock }>("@/api/client");
    return mockClient.doFetch(url);
  }),
  post: jest.fn(),
  put: jest.fn(),
  del: jest.fn()
}));

const mockedDoFetch = doFetch as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetGroceryWindowHydrateForTests();
  useGroceryWindowStore.setState({ windowDays: null, hydrated: false });
});

describe("grocery window store and API", () => {
  it("exposes smart auto ('Planned') as the first option and default", () => {
    expect(GROCERY_WINDOW_OPTIONS[0]).toEqual({ value: null, label: "Planned" });
    expect(useGroceryWindowStore.getState().windowDays).toBeNull();
  });

  it("hydrates and persists a custom window choice", async () => {
    useGroceryWindowStore.getState().setWindowDays(14);
    expect(useGroceryWindowStore.getState().windowDays).toBe(14);

    // Reset in-memory state and re-hydrate from AsyncStorage
    resetGroceryWindowHydrateForTests();
    useGroceryWindowStore.setState({ windowDays: null, hydrated: false });
    await useGroceryWindowStore.getState().hydrate();
    expect(useGroceryWindowStore.getState().windowDays).toBe(14);
    expect(useGroceryWindowStore.getState().hydrated).toBe(true);
  });

  it("persists smart auto null choice when switching back to Planned", async () => {
    useGroceryWindowStore.getState().setWindowDays(7);
    useGroceryWindowStore.getState().setWindowDays(null);

    resetGroceryWindowHydrateForTests();
    useGroceryWindowStore.setState({ windowDays: 7, hydrated: false });
    await useGroceryWindowStore.getState().hydrate();
    expect(useGroceryWindowStore.getState().windowDays).toBeNull();
  });

  it("omits ?days when fetching with smart auto window and passes ?days when configured", async () => {
    mockedDoFetch.mockResolvedValue({});

    await fetchGroceryList(null);
    expect(mockedDoFetch).toHaveBeenLastCalledWith("/grocery/");

    await fetchGroceryList(14);
    expect(mockedDoFetch).toHaveBeenLastCalledWith("/grocery/?days=14");

    await fetchGrocerySummary(null);
    expect(mockedDoFetch).toHaveBeenLastCalledWith("/grocery/summary/");

    await fetchGrocerySummary(3);
    expect(mockedDoFetch).toHaveBeenLastCalledWith("/grocery/summary/?days=3");
  });
});
