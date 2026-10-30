<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { syncAfterRecipeMutation } from "@/stores/sync";
import type {
  IngredientSnapshot,
  RecipeDetail,
  RecipeVersionDetail,
  RecipeVersionDiff,
  RecipeVersionSummary
} from "@/types";
import { get, post, toast } from "@/utils";
import { LoaderCircle } from "@lucide/vue";
import { ref, watch } from "vue";

const props = defineProps<{
  recipeId: number;
  slug: string;
  headVersionNumber: number;
  canRestore: boolean;
}>();

const open = defineModel<boolean>("open", { required: true });

const emit = defineEmits<{
  preview: [version: RecipeVersionDetail];
  restored: [recipe: RecipeDetail];
}>();

const versions = ref<RecipeVersionSummary[]>([]);
const loading = ref(false);
const selected = ref<number | null>(null);
const diff = ref<RecipeVersionDiff | null>(null);
const diffLoading = ref(false);
const restoring = ref<number | null>(null);

const kindLabels: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  ai_edit: "AI edit",
  import: "Imported",
  restore: "Restored"
};

const fieldLabels: Record<string, string> = {
  name: "Name",
  description: "Description",
  notes: "Notes",
  prep_time: "Prep time",
  cover_image: "Cover image",
  instructions: "Instructions"
};

function kindLabel(version: RecipeVersionSummary) {
  if (version.change_kind === "restore" && version.restored_from_version) {
    return `Restored from v${version.restored_from_version}`;
  }
  return kindLabels[version.change_kind] ?? version.change_kind;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatIngredient(row: IngredientSnapshot | null | undefined) {
  if (!row) return "";
  const amount = row.amount != null ? String(row.amount) : "";
  const units = row.units?.trim() ?? "";
  const qty = [amount, units].filter(Boolean).join(" ");
  const details = row.details?.trim();
  return `${qty ? `${qty} ` : ""}${row.name}${details ? ` (${details})` : ""}`;
}

async function loadVersions() {
  loading.value = true;
  try {
    versions.value = await get<RecipeVersionSummary[]>(`/recipe/${props.recipeId}/versions/`);
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t load version history.");
  }
  loading.value = false;
}

async function selectVersion(version: RecipeVersionSummary) {
  selected.value = version.version_number;
  diff.value = null;
  if (version.version_number <= 1) return;
  diffLoading.value = true;
  try {
    diff.value = await get<RecipeVersionDiff>(
      `/recipe/${props.recipeId}/versions/diff/?from=${version.version_number - 1}&to=${version.version_number}`
    );
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t compare those versions.");
  }
  diffLoading.value = false;
}

async function viewVersion(version: RecipeVersionSummary) {
  try {
    const detail = await get<RecipeVersionDetail>(
      `/recipe/${props.recipeId}/versions/${version.version_number}/`
    );
    emit("preview", detail);
    open.value = false;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t open that version.");
  }
}

async function restoreVersion(version: RecipeVersionSummary) {
  if (!props.canRestore || restoring.value) return;
  restoring.value = version.version_number;
  try {
    const before = props.headVersionNumber;
    const detail = await post<RecipeDetail>(
      `/recipe/${props.recipeId}/versions/${version.version_number}/restore/`,
      {}
    );
    emit("restored", detail);
    syncAfterRecipeMutation();
    if (detail.head_version_number === before) {
      toast.success("That version is already the latest content.");
    } else {
      toast.success(
        `Restored version ${version.version_number} as version ${detail.head_version_number}.`
      );
    }
    open.value = false;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t restore that version.");
  }
  restoring.value = null;
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  selected.value = null;
  diff.value = null;
  void loadVersions();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-md overflow-y-auto border-border bg-card">
      <DialogHeader>
        <DialogTitle>Version history</DialogTitle>
        <DialogDescription>
          {{ slug }} · each save is kept. The recipe page shows the latest version.
        </DialogDescription>
      </DialogHeader>

      <p v-if="loading" class="text-sm text-muted-foreground">Loading history…</p>
      <ul v-else class="space-y-2">
        <li
          v-for="version in versions"
          :key="version.version_number"
          class="rounded-xl border border-border bg-background/40 p-3"
        >
          <button type="button" class="w-full text-left" @click="selectVersion(version)">
            <span class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold">Version {{ version.version_number }}</span>
              <span
                v-if="version.is_current"
                class="rounded-full bg-[#16a34a]/20 px-2 py-0.5 text-[11px] font-semibold text-[#4ade80]"
              >
                Latest
              </span>
            </span>
            <span class="mt-0.5 block text-xs text-muted-foreground">
              {{ kindLabel(version) }} · {{ formatWhen(version.created_on) }}
              <template v-if="version.created_by_display_name">
                · {{ version.created_by_display_name }}
              </template>
            </span>
            <span class="mt-1 block truncate text-sm">{{ version.name }}</span>
          </button>

          <div v-if="selected === version.version_number" class="mt-3 space-y-2">
            <p v-if="version.version_number === 1" class="text-xs text-muted-foreground">
              First saved version of this recipe.
            </p>
            <p v-else-if="diffLoading" class="text-xs text-muted-foreground">Comparing…</p>
            <template v-else-if="diff">
              <p
                v-if="!diff.fields.length && !diff.ingredients.length"
                class="text-xs text-muted-foreground"
              >
                No content changes from version {{ diff.from_version }}.
              </p>
              <div v-for="field in diff.fields" :key="field.field" class="text-xs">
                <p class="font-semibold">{{ fieldLabels[field.field] ?? field.field }}</p>
                <template v-if="field.field === 'instructions' && field.hunks.length">
                  <p
                    v-for="(hunk, idx) in field.hunks"
                    :key="idx"
                    class="mt-1 whitespace-pre-wrap rounded-lg bg-secondary/60 px-2 py-1"
                  >
                    <span v-if="hunk.before" class="block text-red-300/90 line-through">{{
                      hunk.before
                    }}</span>
                    <span v-if="hunk.after" class="block text-[#86efac]">{{ hunk.after }}</span>
                  </p>
                </template>
                <p v-else class="mt-1 text-muted-foreground whitespace-pre-wrap">
                  <span v-if="field.before">{{ field.before }}</span>
                  <span v-if="field.before && field.after"> → </span>
                  <span v-if="field.after">{{ field.after }}</span>
                </p>
              </div>
              <div v-if="diff.ingredients.length" class="text-xs">
                <p class="font-semibold">Ingredients</p>
                <p
                  v-for="(change, idx) in diff.ingredients"
                  :key="`${change.op}-${idx}`"
                  class="mt-1 text-muted-foreground"
                >
                  <template v-if="change.op === 'added'"
                    >Added {{ formatIngredient(change.after) }}</template
                  >
                  <template v-else-if="change.op === 'removed'">
                    Removed {{ formatIngredient(change.before) }}
                  </template>
                  <template v-else>
                    {{ formatIngredient(change.before) }} → {{ formatIngredient(change.after) }}
                  </template>
                </p>
              </div>
            </template>

            <div class="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" @click="viewVersion(version)">View</Button>
              <Button
                v-if="canRestore && !version.is_current"
                size="sm"
                :disabled="restoring != null"
                @click="restoreVersion(version)"
              >
                <LoaderCircle
                  v-if="restoring === version.version_number"
                  class="size-4 animate-spin"
                />
                Restore
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </DialogContent>
  </Dialog>
</template>
