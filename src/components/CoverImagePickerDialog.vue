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
import type { UploadSlim } from "@/types";
import { computed, ref, watch } from "vue";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{
  options: UploadSlim[];
}>();
const emit = defineEmits<{
  select: [upload: UploadSlim];
  searchAgain: [];
}>();

const selectedId = ref<number | null>(null);

watch(
  () => [open.value, props.options] as const,
  ([isOpen, options]) => {
    if (isOpen && options.length) {
      selectedId.value = options[0]?.id ?? null;
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
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-md border-border bg-card">
      <DialogHeader>
        <DialogTitle>Choose a cover photo</DialogTitle>
        <DialogDescription>
          Free public-domain food photos matched to this recipe. Tap one to use it.
        </DialogDescription>
      </DialogHeader>

      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="option in options"
          :key="option.id"
          type="button"
          class="overflow-hidden rounded-xl border-2 transition-colors"
          :class="
            selectedId === option.id
              ? 'border-[#22c55e]'
              : 'border-border hover:border-muted-foreground/40'
          "
          @click="selectOption(option.id)"
        >
          <img :src="mediaUrl(option.url)" alt="Cover option" class="h-28 w-full object-cover" />
        </button>
      </div>

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
