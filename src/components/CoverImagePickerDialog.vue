<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { mediaUrl } from "@/lib/media";
import type { RecipeCoverOption } from "@/types";
import { X } from "@lucide/vue";
import { computed, ref, watch } from "vue";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{
  options: RecipeCoverOption[];
  dismissingId?: number | null;
}>();
const emit = defineEmits<{
  select: [upload: RecipeCoverOption];
  searchAgain: [];
  dismiss: [upload: RecipeCoverOption];
}>();

const selectedId = ref<number | null>(null);

watch(
  () => [open.value, props.options] as const,
  ([isOpen, options]) => {
    if (isOpen && options.length) {
      if (!options.some((o) => o.id === selectedId.value)) {
        selectedId.value = options[0]?.id ?? null;
      }
    }
    if (!isOpen) selectedId.value = null;
  },
  { immediate: true }
);

const canConfirm = computed(() => selectedId.value != null);

function selectOption(id: number) {
  selectedId.value = id;
}

function confirm() {
  const chosen = props.options.find((o) => o.id === selectedId.value) ?? props.options[0];
  if (chosen) {
    emit("select", chosen);
    open.value = false;
  }
}

function searchAgain() {
  emit("searchAgain");
}

function dismissOption(event: Event, option: RecipeCoverOption) {
  event.stopPropagation();
  event.preventDefault();
  emit("dismiss", option);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-md border-border bg-card">
      <DialogHeader>
        <DialogTitle>Choose a cover photo</DialogTitle>
        <DialogDescription>
          Free public-domain food photos matched to this recipe. Tap one to use it, or dismiss
          photos you don’t want — Search again won’t show them for this recipe.
        </DialogDescription>
      </DialogHeader>

      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="option in options"
          :key="option.id"
          class="relative overflow-hidden rounded-xl border-2 transition-colors"
          :class="
            selectedId === option.id
              ? 'border-[#22c55e]'
              : 'border-border hover:border-muted-foreground/40'
          "
        >
          <button type="button" class="block w-full" @click="selectOption(option.id)">
            <img :src="mediaUrl(option.url)" alt="Cover option" class="h-28 w-full object-cover" />
          </button>
          <button
            type="button"
            class="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground"
            :disabled="dismissingId === option.id"
            aria-label="Dismiss this photo"
            title="Don’t show again for this recipe"
            @click="dismissOption($event, option)"
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <p v-if="!options.length" class="text-sm text-muted-foreground">
        No options left — try Search again for more photos.
      </p>

      <DialogFooter class="gap-2 sm:justify-between">
        <Button type="button" variant="secondary" @click="searchAgain">Search again</Button>
        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="open = false">Cancel</Button>
          <Button type="button" :disabled="!canConfirm" @click="confirm">Use this photo</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
