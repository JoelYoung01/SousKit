<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { UploadSlim } from "@/types";
import { del, getErrorMessage, postFile, toast } from "@/utils";
import { Camera, ClipboardPaste, ImagePlus, LoaderCircle, Trash2 } from "@lucide/vue";
import { computed, ref, useTemplateRef } from "vue";

interface Props {
  maxSizeMb?: number;
}

const model = defineModel<number | undefined>();
const props = withDefaults(defineProps<Props>(), { maxSizeMb: 5 });
const cameraInputRef = useTemplateRef<HTMLInputElement>("cameraInput");
const libraryInputRef = useTemplateRef<HTMLInputElement>("libraryInput");

const open = ref(false);
const uploading = ref(false);
const deleting = ref(false);

const btnText = computed(() => {
  if (uploading.value) return "Uploading…";
  return model.value ? "Change photo" : "Upload photo";
});

function triggerCameraInput() {
  open.value = false;
  cameraInputRef.value?.click();
}

function triggerLibraryInput() {
  open.value = false;
  libraryInputRef.value?.click();
}

async function processFile(file: File, successMessage?: string) {
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > props.maxSizeMb) {
    toast.error(`Image size exceeds ${props.maxSizeMb}MB limit.`);
    return;
  }
  if (!file.size) {
    toast.error("That file is empty. Pick a different photo.");
    return;
  }

  // Empty filenames make the API treat the part as text, not a file.
  const safeName = file.name?.trim() || `photo-${Date.now()}.jpg`;
  const safeFile =
    safeName === file.name ? file : new File([file], safeName, { type: file.type || "image/jpeg" });

  uploading.value = true;
  try {
    const previousId = model.value;
    const payload = new FormData();
    payload.append("file", safeFile);
    const uploaded = await postFile<UploadSlim>(`upload/`, payload);
    model.value = uploaded.id;
    if (previousId && previousId !== uploaded.id) {
      void del(`/upload/${previousId}/`).catch(() => undefined);
    }
    if (successMessage) {
      toast.success(successMessage);
    }
  } catch (er) {
    console.error(er);
    toast.fromError(er, getErrorMessage(er, "Couldn’t upload that image."));
  } finally {
    uploading.value = false;
  }
}

function handleFileUpload(evt: Event) {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void processFile(file);
  }
  input.value = "";
}

async function readClipboardFile(): Promise<File | null> {
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split("/")[1]?.toLowerCase().replace("jpeg", "jpg") || "png";
          return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType });
        }
      }
    } catch {
      /* Fall back to text data-URI check */
    }
  }

  if (navigator.clipboard?.readText) {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(text);
      if (match) {
        const mimeType = match[1]!.toLowerCase();
        const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
        const blob = await (await fetch(text)).blob();
        return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: mimeType });
      }
    } catch {
      /* Ignore and report no clipboard image found */
    }
  }

  return null;
}

async function pasteFromClipboard() {
  open.value = false;
  const file = await readClipboardFile();
  if (!file) {
    toast.error("No image found on your clipboard. Copy an image first and try again.");
    return;
  }
  await processFile(file, "Cover photo pasted from clipboard.");
}

async function clearFile() {
  open.value = false;
  if (!model.value) return;
  deleting.value = true;
  try {
    await del(`/upload/${model.value}/`);
    model.value = undefined;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t remove that image.");
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button type="button" variant="secondary" class="gap-1.5" :disabled="uploading || deleting">
          <LoaderCircle v-if="uploading" class="size-4 animate-spin" />
          <ImagePlus v-else class="size-4" />
          {{ btnText }}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-56 border-border bg-card p-1.5">
        <div class="flex flex-col gap-0.5">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary"
            @click="triggerCameraInput"
          >
            <Camera class="size-4 text-muted-foreground" />
            <span>Take photo</span>
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary"
            @click="triggerLibraryInput"
          >
            <ImagePlus class="size-4 text-muted-foreground" />
            <span>Camera roll</span>
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary"
            @click="pasteFromClipboard"
          >
            <ClipboardPaste class="size-4 text-muted-foreground" />
            <span>Clipboard</span>
          </button>
          <button
            v-if="model"
            type="button"
            class="mt-0.5 flex w-full items-center gap-2.5 rounded-lg border-t border-border px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-secondary"
            @click="clearFile"
          >
            <Trash2 class="size-4" />
            <span>Remove photo</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>

    <input
      ref="cameraInput"
      type="file"
      class="hidden"
      accept="image/*"
      capture="environment"
      @change="handleFileUpload"
    />
    <input
      ref="libraryInput"
      type="file"
      class="hidden"
      accept="image/*"
      @change="handleFileUpload"
    />
  </div>
</template>
