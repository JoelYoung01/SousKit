<script setup lang="ts">
import type { InlineNode } from "@/lib/markdown";

defineProps<{
  nodes: InlineNode[];
}>();
</script>

<template>
  <template v-for="(node, index) in nodes" :key="index">
    <template v-if="node.type === 'text'">{{ node.text }}</template>
    <br v-else-if="node.type === 'break'" />
    <code
      v-else-if="node.type === 'code'"
      class="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em] text-foreground"
      >{{ node.text }}</code
    >
    <strong v-else-if="node.type === 'strong'" class="font-semibold text-foreground">
      <MarkdownInlines :nodes="node.children" />
    </strong>
    <em v-else-if="node.type === 'em'">
      <MarkdownInlines :nodes="node.children" />
    </em>
    <a
      v-else-if="node.type === 'link'"
      :href="node.href"
      target="_blank"
      rel="noopener noreferrer"
      class="font-medium text-[#22c55e] underline underline-offset-2"
    >
      <MarkdownInlines :nodes="node.children" />
    </a>
  </template>
</template>
