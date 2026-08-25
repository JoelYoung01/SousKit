<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { mediaUrl } from "@/lib/media";
import type { UploadSlim } from "@/types";
import { del, get, getErrorMessage, postFile, toast } from "@/utils";
import { ImagePlus, Trash2 } from "@lucide/vue";
import { computed, useTemplateRef, watch } from "vue";

interface Props {
  maxSizeMb?: number;
}

const model = defineModel<number | undefined>();
const props = withDefaults(defineProps<Props>(), { maxSizeMb: 5 });
const inputRef = useTemplateRef<HTMLInputElement>("fileInput");

const open = ref(false);
const loading = ref(false);
const uploading = ref(false);
const deleting = ref(false);
const errorMsg = ref("");
const fileDetail = ref<UploadSlim>();

const btnText = computed(() => (model.value ? "Change image" : "Upload image"));
const imageUrl = computed(() => mediaUrl(fileDetail.value?.url, ""));

function triggerFileInput() {
  inputRef.value?.click();
}

async function processFile(file: File) {
  errorMsg.value = "";
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > props.maxSizeMb) {
    errorMsg.value = `Image size exceeds ${props.maxSizeMb}MB limit`;
    return;
  }
  if (!file.size) {
    errorMsg.value = "That file is empty. Pick a different photo.";
    return;
  }

  // Empty filenames make the API treat the part as text, not a file.
  const safeName = file.name?.trim() || `photo-${Date.now()}.jpg`;
  const safeFile =
    safeName === file.name ? file : new File([file], safeName, { type: file.type || "image/jpeg" });

  await clearFile();
  uploading.value = true;
  try {
    const payload = new FormData();
    payload.append("file", safeFile);
    fileDetail.value = await postFile<UploadSlim>(`upload/`, payload);
    model.value = fileDetail.value.id;
  } catch (er) {
    console.error(er);
    errorMsg.value = getErrorMessage(er, "Couldn’t upload that image.");
    toast.fromError(er, "Couldn’t upload that image.");
  }
  uploading.value = false;
}

function handleFileUpload(evt: Event) {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) processFile(file);
}

async function clearFile() {
  if (!model.value) return;
  deleting.value = true;
  try {
    await del(`/upload/${model.value}/`);
    model.value = undefined;
    fileDetail.value = undefined;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t remove that image.");
  }
  deleting.value = false;
}

watch(
  model,
  async (val) => {
    if (!val) {
      fileDetail.value = undefined;
      if (inputRef.value) inputRef.value.value = "";
      return;
    }
    loading.value = true;
    try {
      fileDetail.value = await get(`/upload/${val}/`);
    } catch (er) {
      console.error(er);
      errorMsg.value = getErrorMessage(er, "Couldn’t load that image.");
      toast.fromError(er, "Couldn’t load that image.");
    }
    loading.value = false;
  },
  { immediate: true }
);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger>
      <Button type="button" :variant="model ? 'default' : 'outline'" class="border-dashed">
        <ImagePlus class="size-4" />
        {{ btnText }}
      </Button>
    </DialogTrigger>
    <DialogContent class="max-w-sm border-border bg-card">
      <DialogHeader>
        <DialogTitle>Recipe photo</DialogTitle>
      </DialogHeader>

      <button
        type="button"
        class="flex min-h-[200px] w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-secondary/40"
        :disabled="uploading || loading"
        @click="triggerFileInput"
      >
        <img
          v-if="fileDetail && imageUrl"
          :src="imageUrl"
          alt="Recipe cover"
          class="h-[220px] w-full object-cover"
        />
        <div v-else class="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <ImagePlus class="size-8 text-[#22c55e]" />
          <p class="text-sm font-semibold">Upload recipe photo</p>
          <p class="text-xs text-muted-foreground">Tap to browse · JPG, PNG, WEBP</p>
        </div>
      </button>

      <p v-if="errorMsg" class="text-sm text-destructive">{{ errorMsg }}</p>
      <p v-if="uploading || loading" class="text-xs text-muted-foreground">Working…</p>

      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept="image/*"
        @change="handleFileUpload"
      />

      <DialogFooter class="gap-2 sm:justify-between">
        <Button
          v-if="model"
          type="button"
          variant="destructive"
          :disabled="deleting || uploading"
          @click="clearFile"
        >
          <Trash2 class="size-4" />
          Clear
        </Button>
        <Button type="button" :disabled="deleting || uploading" @click="open = false">Done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
