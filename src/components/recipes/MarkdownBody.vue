<script setup lang="ts">
import MarkdownInlines from "@/components/recipes/MarkdownInlines.vue";
import { parseMarkdown, type BlockNode, type ListBlock } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    source?: string | null;
    blocks?: BlockNode[];
    size?: "sm" | "base";
  }>(),
  { source: "", size: "base" }
);

const resolved = computed(() => props.blocks ?? parseMarkdown(props.source || ""));
const bodyClass = computed(() =>
  props.size === "sm" ? "text-sm leading-relaxed" : "text-base leading-relaxed"
);

function headingClass(level: 1 | 2 | 3) {
  if (props.size === "sm") {
    return level === 1
      ? "text-base font-semibold text-foreground"
      : "text-sm font-semibold text-foreground";
  }
  if (level === 1) return "text-lg font-semibold text-foreground";
  if (level === 2) return "text-base font-semibold text-foreground";
  return "text-sm font-semibold text-foreground";
}

function asList(block: BlockNode): ListBlock {
  return block as ListBlock;
}
</script>

<template>
  <div :class="cn('space-y-2.5 text-muted-foreground', bodyClass)">
    <template v-for="(block, index) in resolved" :key="index">
      <component
        :is="block.type === 'heading' ? (block.level === 1 ? 'h3' : 'h4') : 'p'"
        v-if="block.type === 'heading' || block.type === 'paragraph'"
        :class="block.type === 'heading' ? headingClass(block.level) : undefined"
      >
        <MarkdownInlines :nodes="block.children" />
      </component>
      <component
        :is="asList(block).ordered ? 'ol' : 'ul'"
        v-else
        :start="asList(block).ordered ? asList(block).start : undefined"
        :class="cn('space-y-2 pl-5', asList(block).ordered ? 'list-decimal' : 'list-disc')"
      >
        <li v-for="(item, itemIndex) in asList(block).items" :key="itemIndex">
          <MarkdownInlines :nodes="item.children" />
          <MarkdownBody v-if="item.nested" class="mt-1" :blocks="[item.nested]" :size="size" />
        </li>
      </component>
    </template>
  </div>
</template>
