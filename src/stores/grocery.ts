import type {
  GroceryItem,
  GroceryListResponse,
  GroceryManualItemCreate,
  GrocerySummaryResponse
} from "@/types";
import { del, get, getErrorMessage, post, put, toast } from "@/utils";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useGroceryStore = defineStore("grocery", () => {
  const items = ref<GroceryItem[]>([]);
  const windowStart = ref<string | null>(null);
  const windowEnd = ref<string | null>(null);
  const loading = ref(false);
  const refreshing = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const activeCount = ref<number | null>(null);
  const revision = ref(0);
  let listInflight: Promise<void> | null = null;
  let summaryInflight: Promise<number> | null = null;

  const activeItems = computed(() => items.value.filter((i) => !i.dismissed && !i.deleted));

  async function fetchSummary(force = false): Promise<number> {
    if (!force && activeCount.value !== null) return activeCount.value;
    if (summaryInflight) return summaryInflight;
    summaryInflight = (async () => {
      try {
        const res = await get<GrocerySummaryResponse>("/grocery/summary/");
        activeCount.value = res.active_count;
        windowStart.value = res.window_start;
        windowEnd.value = res.window_end;
        return res.active_count;
      } finally {
        summaryInflight = null;
      }
    })();
    return summaryInflight;
  }

  async function ensureLoaded(opts?: { force?: boolean }) {
    if (listInflight) return listInflight;

    const soft = loaded.value && items.value.length > 0 && !opts?.force;
    if (soft) refreshing.value = true;
    else loading.value = true;
    error.value = null;

    listInflight = (async () => {
      try {
        const data = await get<GroceryListResponse>("/grocery/");
        items.value = data.items;
        windowStart.value = data.window_start;
        windowEnd.value = data.window_end;
        activeCount.value = data.items.filter((i) => !i.dismissed && !i.deleted).length;
        loaded.value = true;
      } catch (er) {
        console.error(er);
        error.value = getErrorMessage(er, "Couldn’t load your grocery list.");
        toast.fromError(er, "Couldn’t load your grocery list.");
        throw er;
      } finally {
        loading.value = false;
        refreshing.value = false;
        listInflight = null;
      }
    })();

    return listInflight;
  }

  function patchLocal(key: string, patch: Partial<GroceryItem>) {
    items.value = items.value.map((item) => (item.key === key ? { ...item, ...patch } : item));
    activeCount.value = items.value.filter((i) => !i.dismissed && !i.deleted).length;
  }

  async function setStatus(
    item: GroceryItem,
    status: "dismissed" | "deleted" | "restored" | null
  ) {
    const previous = { dismissed: item.dismissed, deleted: item.deleted };
    patchLocal(item.key, {
      dismissed: status === "dismissed",
      deleted: status === "deleted"
    });
    try {
      await put("/grocery/state/", { item_key: item.key, status });
    } catch (er) {
      console.error(er);
      patchLocal(item.key, previous);
      toast.fromError(er, "Couldn’t update that grocery item.");
      throw er;
    }
  }

  async function addManualItem(body: GroceryManualItemCreate) {
    const created = await post<GroceryItem>("/grocery/items/", body);
    await ensureLoaded({ force: true });
    return created;
  }

  async function deleteManualItem(itemId: number) {
    await del(`/grocery/items/${itemId}/`);
    await ensureLoaded({ force: true });
  }

  function invalidate() {
    loaded.value = false;
    activeCount.value = null;
    revision.value += 1;
  }

  function reset() {
    items.value = [];
    windowStart.value = null;
    windowEnd.value = null;
    loading.value = false;
    refreshing.value = false;
    error.value = null;
    invalidate();
  }

  return {
    items,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    loaded,
    error,
    activeCount,
    activeItems,
    revision,
    fetchSummary,
    ensureLoaded,
    setStatus,
    addManualItem,
    deleteManualItem,
    patchLocal,
    invalidate,
    reset
  };
});
