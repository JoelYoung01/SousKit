<script setup lang="ts">
import MarkdownBody from "@/components/recipes/MarkdownBody.vue";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ref } from "vue";

withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue?: string | null;
    required?: boolean;
    minHeightClass?: string;
  }>(),
  { modelValue: "", required: false, minHeightClass: "min-h-24" }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const mode = ref<"write" | "preview">("write");
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-3">
      <Label :for="id">{{ label }}</Label>
      <div class="flex rounded-lg bg-secondary/60 p-0.5 text-xs font-semibold">
        <button
          type="button"
          class="rounded-md px-2 py-1"
          :class="mode === 'write' ? 'bg-card text-foreground' : 'text-muted-foreground'"
          @click="mode = 'write'"
        >
          Write
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1"
          :class="mode === 'preview' ? 'bg-card text-foreground' : 'text-muted-foreground'"
          @click="mode = 'preview'"
        >
          Preview
        </button>
      </div>
    </div>
    <Textarea
      v-show="mode === 'write'"
      :id="id"
      :model-value="modelValue || ''"
      :required="required"
      :class="cn(minHeightClass, 'rounded-xl bg-card')"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <div
      v-if="mode === 'preview'"
      :class="cn('rounded-xl border border-input bg-card px-3 py-3', minHeightClass)"
    >
      <MarkdownBody v-if="modelValue?.trim()" :source="modelValue" />
      <p v-else class="text-sm text-muted-foreground">Nothing to preview.</p>
    </div>
    <p class="text-xs text-muted-foreground">Markdown works here: **bold**, *italic*, and lists.</p>
  </div>
</template>
