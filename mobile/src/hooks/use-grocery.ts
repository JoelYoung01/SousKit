import {
  createManualGroceryItem,
  deleteManualGroceryItem,
  fetchGroceryList,
  fetchGrocerySummary,
  setGroceryItemStatus,
  updateManualGroceryItem
} from "@/api/grocery";
import { queryClient } from "@/lib/query-client";
import { toast } from "@/stores/toast";
import type {
  GroceryItem,
  GroceryItemStatus,
  GroceryListResponse,
  GroceryManualItemCreate,
  GroceryManualItemUpdate,
  GroceryWindowChoice
} from "@/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { create } from "zustand";

const WINDOW_STORAGE_KEY = "souskit.grocery-window-days.v1";

interface GroceryWindowState {
  windowDays: GroceryWindowChoice;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setWindowDays: (days: GroceryWindowChoice) => void;
}

let hydrateStarted = false;

/** Test hook — lets Jest re-run hydrate in isolation. */
export function resetGroceryWindowHydrateForTests() {
  hydrateStarted = false;
}

export const useGroceryWindowStore = create<GroceryWindowState>((set) => ({
  windowDays: null,
  hydrated: false,
  async hydrate() {
    if (hydrateStarted) return;
    hydrateStarted = true;
    try {
      const raw = await AsyncStorage.getItem(WINDOW_STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 1)) {
          set({ windowDays: parsed, hydrated: true });
          return;
        }
      }
    } catch {
      /* ignore corrupted storage */
    }
    set({ hydrated: true });
  },
  setWindowDays(days) {
    set({ windowDays: days });
    void AsyncStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(days));
  }
}));

export function useGroceryWindow() {
  const windowDays = useGroceryWindowStore((s) => s.windowDays);
  const setWindowDays = useGroceryWindowStore((s) => s.setWindowDays);
  void useGroceryWindowStore.getState().hydrate();
  return { windowDays, setWindowDays };
}

function listKey(days: GroceryWindowChoice) {
  return ["grocery", "list", days] as const;
}

export function useGroceryList() {
  const { windowDays } = useGroceryWindow();
  return useQuery({
    queryKey: listKey(windowDays),
    queryFn: () => fetchGroceryList(windowDays),
    refetchOnMount: "always"
  });
}

export function useGrocerySummary() {
  const { windowDays } = useGroceryWindow();
  return useQuery({
    queryKey: ["grocery", "summary", windowDays],
    queryFn: () => fetchGrocerySummary(windowDays),
    select: (r) => r.active_count
  });
}

/** Optimistic dismiss/delete/restore of a grocery line. */
export function useSetGroceryStatus() {
  return useMutation({
    mutationFn: ({ item, status }: { item: GroceryItem; status: GroceryItemStatus }) =>
      setGroceryItemStatus(item.key, status),
    onMutate: async ({ item, status }) => {
      const key = listKey(useGroceryWindowStore.getState().windowDays);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<GroceryListResponse>(key);
      if (previous) {
        queryClient.setQueryData<GroceryListResponse>(key, {
          ...previous,
          items: previous.items.map((i) =>
            i.key === item.key
              ? { ...i, dismissed: status === "dismissed", deleted: status === "deleted" }
              : i
          )
        });
      }
      return { previous, key };
    },
    onError: (error, _vars, context) => {
      if (context?.previous && context.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
      toast.fromError(error, "Could not update the item.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["grocery"] });
    }
  });
}

export function useCreateManualGroceryItem() {
  return useMutation({
    mutationFn: (body: GroceryManualItemCreate) => createManualGroceryItem(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["grocery"] });
    },
    onError: (error) => {
      toast.fromError(error, "Could not add that item.");
    }
  });
}

export function useDeleteManualGroceryItem() {
  return useMutation({
    mutationFn: (itemId: number) => deleteManualGroceryItem(itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["grocery"] });
    },
    onError: (error) => {
      toast.fromError(error, "Could not remove that item.");
    }
  });
}

export function useUpdateManualGroceryItem() {
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: GroceryManualItemUpdate }) =>
      updateManualGroceryItem(itemId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["grocery"] });
    },
    onError: (error) => {
      toast.fromError(error, "Could not update that item.");
    }
  });
}
