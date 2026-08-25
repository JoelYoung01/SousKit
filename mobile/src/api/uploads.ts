import type { UploadSlim } from "@/types";
import { Platform } from "react-native";
import { postFile } from "./client";
import { normalizePickedImage } from "./imageUpload";

export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

/** Upload a picked image as multipart form data → Upload record. */
export async function uploadImage(asset: PickedImage): Promise<UploadSlim> {
  const { uri, fileName, mimeType } = normalizePickedImage(asset);
  const form = new FormData();

  if (Platform.OS === "web") {
    // On web the picker returns a blob/data URI — materialize it into a File.
    let blob: Blob;
    try {
      blob = await (await fetch(uri)).blob();
    } catch (er) {
      const reason = er instanceof Error ? er.message : "could not read the selected file";
      throw new Error(
        `Couldn’t read that photo (${reason}). Try another image or take a new one.`
      );
    }
    form.append("file", new File([blob], fileName, { type: mimeType || blob.type || "image/jpeg" }));
  } else {
    // React Native FormData accepts a { uri, name, type } file descriptor.
    // `name` must be non-empty or the server treats the part as a text field.
    form.append("file", { uri, name: fileName, type: mimeType } as unknown as Blob);
  }

  return postFile<UploadSlim>("/upload/", form);
}
