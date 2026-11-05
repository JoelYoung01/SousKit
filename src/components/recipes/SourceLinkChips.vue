<script setup lang="ts">
import type { RecipeSourceLink } from "@/types";
import { ExternalLink } from "@lucide/vue";

defineProps<{
  links: RecipeSourceLink[];
}>();
</script>

<template>
  <div v-if="links.length" class="flex flex-wrap gap-2">
    <a
      v-for="link in links"
      :key="link.url"
      :href="link.url"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm font-medium text-[#4ade80]"
      :aria-label="`${link.name}. Opens ${link.url}`"
    >
      <span class="truncate">{{ link.name }}</span>
      <ExternalLink class="size-3.5 shrink-0 opacity-80" />
    </a>
  </div>
</template>
