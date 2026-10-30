<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, mediaUrl, startOfDay, startOfWeekMonday, toDateKey } from "@/lib/media";
import { paths } from "@/sitemap";
import { useGroceryStore } from "@/stores/grocery";
import { usePlannerStore } from "@/stores/planner";
import { useRecipesStore } from "@/stores/recipes";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/utils";
import { CalendarDays, Plus, Search, ShoppingCart, Sparkles, User } from "@lucide/vue";
import { computed, onActivated, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

defineOptions({ name: "HomeView" });

const router = useRouter();
const session = useSessionStore();
const recipesStore = useRecipesStore();
const groceryStore = useGroceryStore();
const plannerStore = usePlannerStore();

const loading = ref(true);
const plansReady = ref(false);

const today = startOfDay();
const thisWeekStart = startOfWeekMonday(today);
const thisWeekEnd = addDays(thisWeekStart, 6);

const weekdayName = computed(() => today.toLocaleDateString(undefined, { weekday: "long" }));

/** Derived from the shared planner store so KeepAlive tabs stay in sync. */
const weekPlans = computed(() => plannerStore.plansInRange(thisWeekStart, thisWeekEnd));

const tonight = computed(() => {
  const key = toDateKey(today);
  return weekPlans.value.find((p) => p.planned_for.startsWith(key)) ?? null;
});

const tonightImage = computed(() => mediaUrl(tonight.value?.recipe.cover_image?.url));

const showHeroSkeleton = computed(() => loading.value && !plansReady.value && !tonight.value);

const recipeCount = computed(() => recipesStore.count ?? 0);
const groceryCount = computed(() => groceryStore.activeCount ?? 0);
const hasPendingGrocery = computed(() => groceryCount.value > 0);

async function loadWeekPlans() {
  try {
    await plannerStore.ensureRange(thisWeekStart, thisWeekEnd);
    plansReady.value = true;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t load tonight’s plan.");
    plansReady.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadBadges() {
  try {
    await Promise.all([recipesStore.fetchCount(), groceryStore.fetchSummary()]);
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t load recipe and grocery counts.");
  }
}

function cookTonight() {
  if (!tonight.value) {
    router.push(paths.planner);
    return;
  }
  router.push({
    path: paths.recipeDetail(tonight.value.recipe.id),
    query: { returnUrl: paths.home }
  });
}

async function refreshHome() {
  await Promise.all([loadBadges(), loadWeekPlans()]);
}

onMounted(() => {
  void refreshHome();
});
onActivated(() => {
  void refreshHome();
});

// If another page invalidates planner while Home is cached, refetch the visible window.
watch(
  () => plannerStore.revision,
  () => {
    void loadWeekPlans();
  }
);
</script>

<template>
  <div class="flex min-h-[calc(100dvh-5.5rem)] flex-col">
    <!-- Tonight hero -->
    <section class="relative h-[300px] shrink-0 overflow-hidden">
      <img
        v-if="tonight"
        :src="tonightImage"
        :alt="tonight.recipe.name"
        class="absolute inset-0 size-full object-cover"
      />
      <div
        v-else
        class="absolute inset-0 bg-[repeating-linear-gradient(45deg,#232623_0_10px,#1d201d_10px_20px)]"
      />
      <div
        class="absolute inset-0 bg-gradient-to-b from-background/50 via-transparent to-[rgba(9,11,9,0.95)]"
      />

      <div class="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-4">
        <h1 class="text-base font-bold tracking-tight text-foreground">{{ weekdayName }}</h1>
        <button
          type="button"
          class="flex size-[34px] items-center justify-center rounded-full bg-foreground/15 text-foreground backdrop-blur-sm transition-opacity active:opacity-80"
          aria-label="Account"
          @click="router.push(paths.account)"
        >
          <img
            v-if="session.currentUser?.avatar_url"
            :src="session.currentUser.avatar_url"
            alt=""
            class="size-full rounded-full object-cover"
          />
          <User v-else class="size-4 opacity-80" :stroke-width="2" />
        </button>
      </div>

      <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-5 pb-4">
        <div class="min-w-0">
          <p class="text-[11px] font-bold tracking-[0.08em] text-success-soft">TONIGHT</p>
          <template v-if="tonight">
            <p class="mt-0.5 text-xl font-bold tracking-tight leading-tight text-foreground">
              {{ tonight.recipe.name }}
            </p>
          </template>
          <template v-else-if="showHeroSkeleton">
            <Skeleton class="mt-1.5 h-6 w-40 bg-foreground/20" />
          </template>
          <template v-else>
            <p class="mt-0.5 text-xl font-bold tracking-tight leading-tight text-foreground">
              Nothing planned
            </p>
          </template>
        </div>
        <Button
          class="shrink-0 rounded-[11px] px-5 py-2.5 text-[13px] font-semibold"
          @click="cookTonight"
        >
          {{ tonight ? "Cook" : "Plan" }}
        </Button>
      </div>
    </section>

    <!-- Action cards: Create Plan / Create / Import / Dynamic (Grocery or Find) -->
    <section class="grid grid-cols-2 gap-2 px-5 pt-4">
      <button
        type="button"
        class="flex min-h-[104px] flex-col items-start justify-between rounded-xl border border-border bg-card p-3.5 text-left transition-opacity active:opacity-80"
        @click="router.push(paths.plannerFill)"
      >
        <CalendarDays class="size-[18px] shrink-0 text-[#22c55e]/55" :stroke-width="2" />
        <span class="mt-3">
          <span class="block text-sm font-semibold">Create Plan</span>
          <span class="mt-0.5 block text-[11.5px] text-faint">Plan your nights</span>
        </span>
      </button>

      <button
        type="button"
        class="flex min-h-[104px] flex-col items-start justify-between rounded-xl border border-border bg-card p-3.5 text-left transition-opacity active:opacity-80"
        @click="router.push(paths.recipeGenerate)"
      >
        <Sparkles class="size-[18px] shrink-0 text-[#22c55e]/55" :stroke-width="2" />
        <span class="mt-3">
          <span class="block text-sm font-semibold">Create</span>
          <span class="mt-0.5 block text-[11.5px] text-faint">Cook right now</span>
        </span>
      </button>

      <button
        type="button"
        class="flex min-h-[104px] flex-col items-start justify-between rounded-xl border border-border bg-card p-3.5 text-left transition-opacity active:opacity-80"
        @click="router.push(`${paths.recipeImport}?method=link`)"
      >
        <Plus class="size-[18px] shrink-0 text-[#22c55e]/55" :stroke-width="2" />
        <span class="mt-3">
          <span class="block text-sm font-semibold">Import</span>
          <span class="mt-0.5 block text-[11.5px] text-faint">link · photo</span>
        </span>
      </button>

      <button
        v-if="hasPendingGrocery"
        type="button"
        class="flex min-h-[104px] flex-col items-start justify-between rounded-xl border border-border bg-card p-3.5 text-left transition-opacity active:opacity-80"
        @click="router.push(paths.list)"
      >
        <ShoppingCart class="size-[18px] shrink-0 text-[#22c55e]/55" :stroke-width="2" />
        <span class="mt-3">
          <span class="block text-sm font-semibold">Grocery</span>
          <span
            class="mt-0.5 inline-flex rounded-full border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.12)] px-2 py-0.5 text-[11px] font-bold text-[#4ade80]"
          >
            {{ groceryCount }}
          </span>
        </span>
      </button>

      <button
        v-else
        type="button"
        class="flex min-h-[104px] flex-col items-start justify-between rounded-xl border border-border bg-card p-3.5 text-left transition-opacity active:opacity-80"
        @click="router.push(paths.recipes)"
      >
        <Search class="size-[18px] shrink-0 text-[#22c55e]/55" :stroke-width="2" />
        <span class="mt-3">
          <span class="block text-sm font-semibold">Find</span>
          <span class="mt-0.5 block text-[11.5px] text-faint">
            <template v-if="recipesStore.count === null">
              <Skeleton class="inline-block h-3 w-10 align-middle" />
            </template>
            <template v-else>{{ recipeCount }} saved</template>
          </span>
        </span>
      </button>
    </section>
  </div>
</template>
