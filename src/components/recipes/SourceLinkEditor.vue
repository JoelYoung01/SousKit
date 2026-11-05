<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applySourceLinkInput,
  hostnameLabel,
  isPlaceholderName,
  lookupSiteName,
  mergeSourceLinks,
  parseSourceLinkInput,
  type SourceLinkDraft
} from "@/lib/sourceLinks";
import type { RecipeSourceLink } from "@/types";
import { post, toast } from "@/utils";
import { X } from "@lucide/vue";
import { ref, watch } from "vue";

const props = defineProps<{ links: RecipeSourceLink[] }>();
const emit = defineEmits<{ "update:links": [links: RecipeSourceLink[]] }>();

const drafts = ref<SourceLinkDraft[]>([]);
const draftText = ref("");
const pendingName = ref("");
const editingIndex = ref<number | null>(null);
const editingText = ref("");
const lookups = new Map<string, number>();
let lookupSeq = 0;

function toPayload(rows: SourceLinkDraft[]): RecipeSourceLink[] {
  return rows.map(({ name, url }) => ({ name, url }));
}

function sameLinks(saved: RecipeSourceLink[], current: SourceLinkDraft[]) {
  if (saved.length !== current.length) return false;
  return saved.every(
    (link, index) => link.url === current[index]?.url && link.name === current[index]?.name
  );
}

function publish(rows: SourceLinkDraft[]) {
  drafts.value = rows;
  emit("update:links", toPayload(rows));
}

async function refreshName(url: string) {
  const token = ++lookupSeq;
  lookups.set(url, token);
  const resolved = await lookupSiteName(url, (value) =>
    post<RecipeSourceLink>("/recipe/source-links/resolve/", { url: value })
  );
  if (lookups.get(url) !== token) return;
  const index = drafts.value.findIndex((link) => link.url === url && link.autoName);
  if (index < 0) return;
  const next = drafts.value.slice();
  next[index] = {
    name: resolved.name,
    url: resolved.url || url,
    autoName: true
  };
  publish(next);
}

watch(
  () => props.links,
  (links) => {
    if (sameLinks(links, drafts.value)) return;
    const next = links.map((link) => ({
      name: link.name,
      url: link.url,
      autoName: isPlaceholderName(link.name, link.url)
    }));
    drafts.value = next;
    for (const link of next) {
      if (link.autoName) void refreshName(link.url);
    }
  },
  { immediate: true }
);

function commitDraft() {
  const raw = draftText.value;
  if (!raw.trim()) return;
  const applied = applySourceLinkInput(raw, pendingName.value);
  pendingName.value = applied.pendingName;
  draftText.value = "";
  if (!applied.additions.length) return;
  const before = drafts.value.length;
  const merged = mergeSourceLinks(drafts.value, applied.additions);
  publish(merged.links);
  if (merged.rejected === "limit") {
    toast.error("You can save up to 12 source links.");
  } else if (merged.rejected === "duplicate" && merged.links.length === before) {
    toast.error("That link is already on this recipe.");
  }
  for (const addition of applied.additions) {
    if (addition.autoName && merged.links.some((link) => link.url === addition.url)) {
      void refreshName(addition.url);
    }
  }
}

function removeLink(index: number) {
  publish(drafts.value.filter((_, itemIndex) => itemIndex !== index));
}

function startRename(index: number) {
  editingIndex.value = index;
  editingText.value = drafts.value[index]?.name ?? "";
}

function commitRename() {
  const index = editingIndex.value;
  if (index == null) return;
  editingIndex.value = null;
  const raw = editingText.value.trim();
  const current = drafts.value[index];
  if (!raw || !current) return;
  const parsed = parseSourceLinkInput(raw);
  const next = drafts.value.slice();
  const only = parsed.length === 1 ? parsed[0] : undefined;
  if (only?.url) {
    next[index] = {
      name: only.name || hostnameLabel(only.url),
      url: only.url,
      autoName: !only.name
    };
    publish(next);
    if (!only.name) void refreshName(only.url);
    return;
  }
  next[index] = { ...current, name: raw, autoName: false };
  publish(next);
}
</script>

<template>
  <div class="space-y-2">
    <Label for="source-links">Sources</Label>
    <div v-if="drafts.length" class="flex flex-wrap gap-2">
      <span
        v-for="(link, index) in drafts"
        :key="`${link.url}-${index}`"
        class="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-1 pr-1 pl-3 text-sm"
      >
        <input
          v-if="editingIndex === index"
          v-model="editingText"
          class="w-36 bg-transparent text-sm text-foreground outline-none"
          :aria-label="`Name for ${link.url}`"
          autofocus
          @keydown.enter.prevent="commitRename"
          @blur="commitRename"
        />
        <button
          v-else
          type="button"
          class="max-w-52 truncate font-medium text-[#4ade80]"
          :title="link.url"
          @click="startRename(index)"
        >
          {{ link.name }}
        </button>
        <button
          type="button"
          class="rounded-full p-1 text-muted-foreground hover:text-foreground"
          :aria-label="`Remove ${link.name}`"
          @click="removeLink(index)"
        >
          <X class="size-3.5" />
        </button>
      </span>
    </div>
    <Input
      id="source-links"
      v-model="draftText"
      placeholder="Paste a URL or site name"
      class="h-11 rounded-xl bg-card"
      autocomplete="off"
      @keydown.enter.prevent="commitDraft"
      @blur="commitDraft"
    />
    <p v-if="pendingName" class="text-xs text-muted-foreground">
      Next link will be labeled “{{ pendingName }}”.
      <button type="button" class="underline" @click="pendingName = ''">Clear</button>
    </p>
    <p class="text-xs text-muted-foreground">
      Paste a link, a comma-separated list, or a site name. The chip uses the website name, and the
      URL is saved separately. Tap a chip to rename it.
    </p>
  </div>
</template>
