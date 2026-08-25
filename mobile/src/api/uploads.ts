import type { UploadSlim } from "@/types";
import { Platform } from "react-native";
import { File as ExpoFile, UploadType } from "expo-file-system";
import { API_URL } from "@/config";
import { queryClient } from "@/lib/query-client";
import { defaultUploadFileName, inferImageMimeType } from "@/lib/upload-media";
import { useSessionStore } from "@/stores/session";
import { ApiError, postFile } from "./client";
import { parseApiErrorBody } from "./errors";

export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

const NETWORK_MESSAGE = "Network error — check your connection and try again.";

function clearSessionOnUnauthorized(status: number, token: string | null) {
  if (status === 401 && token) {
    void useSessionStore.getState().clear();
    queryClient.clear();
  }
}

function throwForUploadResponse(status: number, bodyText: string): never {
  let body: unknown = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }
  const parsed = parseApiErrorBody(body);
  throw new ApiError(parsed.userMessage, status, {
    userMessage: parsed.userMessage,
    detail: parsed.detail,
    code: parsed.code
  });
}

/** Upload via expo-file-system so iOS uses native multipart networking (RN fetch FormData is flaky). */
async function uploadNative(asset: PickedImage): Promise<UploadSlim> {
  const name = defaultUploadFileName(asset.fileName, asset.mimeType);
  const type = inferImageMimeType(name, asset.mimeType);
  const token = useSessionStore.getState().token;
  const file = new ExpoFile(asset.uri);

  if (!file.exists) {
    throw new ApiError("Could not read the selected photo.", 400, {
      userMessage: "Could not read the selected photo. Try choosing a different image."
    });
  }

  let result;
  try {
    result = await file.upload(`${API_URL}/upload/`, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: type,
      sessionType: "foreground",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 503, { userMessage: NETWORK_MESSAGE });
  }

  clearSessionOnUnauthorized(result.status, token);
  if (result.status >= 400) {
    throwForUploadResponse(result.status, result.body);
  }

  return JSON.parse(result.body) as UploadSlim;
}

/** Upload a picked image as multipart form data → Upload record. */
export async function uploadImage(asset: PickedImage): Promise<UploadSlim> {
  if (Platform.OS !== "web") {
    return uploadNative(asset);
  }

  const name = defaultUploadFileName(asset.fileName, asset.mimeType);
  const type = inferImageMimeType(name, asset.mimeType);
  const form = new FormData();
  const blob = await (await fetch(asset.uri)).blob();
  form.append("file", new File([blob], name, { type }));

  return postFile<UploadSlim>("/upload/", form);
}
