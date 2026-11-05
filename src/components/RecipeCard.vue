<script setup lang="ts">
import { markdownToPlain } from "@/lib/markdown";
import { formatPrepTime, mediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";
import { paths } from "@/sitemap";
import type { RecipeCard } from "@/types";
import { Clock } from "@lucide/vue";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const props = withDefaults(
  defineProps<{
    recipe: RecipeCard & {
      created_by?: { display_name: string };
    };
    size?: "sm" | "md";
    mode?: "default" | "public";
  }>(),
  { size: "md", mode: "default" }
);

const router = useRouter();
const route = useRoute();

const image = computed(() => mediaUrl(props.recipe.cover_image?.url));
const prep = computed(() => formatPrepTime(props.recipe.prep_time));

function open() {
  router.push({
    path: paths.recipeDetail(props.recipe.id),
    query: { returnUrl: route.fullPath }
  });
}
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'flex w-full items-stretch gap-3 overflow-hidden rounded-xl border border-border bg-card text-left transition-opacity active:opacity-80',
        /* Outer padding ≥ relatedness gap; image radius = outer (12) − pad */
        size === 'sm' ? 'p-2' : 'p-3'
      )
    "
    @click="open"
  >
    <!-- draggable=false keeps native image drag from hijacking swipe gestures -->
    <img
      :src="image"
      :alt="recipe.name"
      draggable="false"
      :class="
        cn('shrink-0 object-cover', size === 'sm' ? 'size-14 rounded-[4px]' : 'size-20 rounded-sm')
      "
    />
    <div class="min-w-0 flex-1 py-0.5">
      <p :class="cn('truncate font-semibold', size === 'sm' ? 'text-sm' : 'text-[15px]')">
        {{ recipe.name }}
      </p>
      <p
        v-if="mode === 'public' && recipe.created_by"
        class="mt-0.5 truncate text-xs text-muted-foreground"
      >
        {{ recipe.created_by.display_name }}
      </p>
      <p v-else-if="recipe.description" class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
        {{ markdownToPlain(recipe.description) }}
      </p>
      <p
        v-if="mode === 'default' && prep"
        class="mt-1.5 flex items-center gap-1 text-[11px] text-faint"
      >
        <Clock class="size-3 opacity-70" />
        {{ prep }}
      </p>
    </div>
  </button>
</template>
