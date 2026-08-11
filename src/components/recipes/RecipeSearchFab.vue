<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, X } from "@lucide/vue";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const model = defineModel<string>({ default: "" });

const expanded = ref(false);
const barEl = ref<HTMLElement | null>(null);
/** Pixels covered by the on-screen keyboard (visualViewport). */
const keyboardInset = ref(0);

function measureKeyboard() {
  const vv = window.visualViewport;
  if (!vv) {
    keyboardInset.value = 0;
    return;
  }
  // Amount of the layout viewport covered below the visual viewport (keyboard).
  keyboardInset.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

function focusInput() {
  const input = barEl.value?.querySelector("input");
  input?.focus();
}

async function openSearch() {
  expanded.value = true;
  await nextTick();
  focusInput();
}

function closeSearch() {
  expanded.value = false;
  const input = barEl.value?.querySelector("input");
  input?.blur();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && expanded.value) {
    event.preventDefault();
    if (model.value) {
      model.value = "";
    } else {
      closeSearch();
    }
  }
}

watch(expanded, (isOpen) => {
  if (isOpen) measureKeyboard();
});

onMounted(() => {
  measureKeyboard();
  window.visualViewport?.addEventListener("resize", measureKeyboard);
  window.visualViewport?.addEventListener("scroll", measureKeyboard);
  window.addEventListener("resize", measureKeyboard);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener("resize", measureKeyboard);
  window.visualViewport?.removeEventListener("scroll", measureKeyboard);
  window.removeEventListener("resize", measureKeyboard);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    class="pointer-events-none fixed left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-4 transition-[bottom] duration-200 ease-out"
    :style="{
      // Stay above the tab bar unless the keyboard covers more of the viewport.
      bottom: `max(calc(5.75rem + env(safe-area-inset-bottom)), calc(${keyboardInset}px + 0.75rem))`
    }"
  >
    <!-- Collapsed FAB (bottom-right) -->
    <div
      class="flex justify-end transition-opacity duration-150"
      :class="expanded ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'"
    >
      <button
        type="button"
        class="flex size-14 items-center justify-center rounded-full border border-border bg-card text-[#22c55e] shadow-[0_4px_8px_rgba(22,163,74,0.28)] transition-transform duration-200 active:scale-95"
        aria-label="Search recipes"
        :tabindex="expanded ? -1 : 0"
        @click="openSearch"
      >
        <Search class="size-5" :stroke-width="2.2" />
      </button>
    </div>

    <!-- Expanded full-width bar, sits above the keyboard when open -->
    <div
      ref="barEl"
      class="absolute inset-x-4 bottom-0 transition-all duration-200 ease-out"
      :class="
        expanded
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-3 opacity-0'
      "
    >
      <div
        :class="
          cn(
            'relative flex items-center gap-2 rounded-2xl border border-border bg-card px-3 shadow-[0_4px_8px_rgba(0,0,0,0.35)]',
            'origin-bottom-right transition-transform duration-200 ease-out',
            expanded ? 'scale-100' : 'scale-90'
          )
        "
      >
        <Search class="size-4 shrink-0 text-faint" :stroke-width="2" />
        <Input
          v-model="model"
          type="search"
          placeholder="Search recipes…"
          enterkeyhint="search"
          autocomplete="off"
          class="h-12 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          :tabindex="expanded ? 0 : -1"
          @keydown.escape.prevent="closeSearch"
        />
        <button
          type="button"
          class="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity active:opacity-70"
          :aria-label="model ? 'Clear search' : 'Close search'"
          :tabindex="expanded ? 0 : -1"
          @click="model ? (model = '') : closeSearch()"
        >
          <X class="size-4" :stroke-width="2" />
        </button>
      </div>
    </div>
  </div>
</template>
