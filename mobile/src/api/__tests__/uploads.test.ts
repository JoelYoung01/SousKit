import type { UploadSlim } from "@/types";

const mockUpload = jest.fn();
const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockExists = jest.fn(() => true);

jest.mock("expo-file-system", () => ({
  UploadType: { MULTIPART: 1 },
  Paths: { cache: "file:///tmp" },
  File: jest.fn().mockImplementation(() => ({
    get exists() {
      return mockExists();
    },
    write: mockWrite,
    delete: mockDelete,
    upload: mockUpload
  }))
}));

jest.mock("@/config", () => ({
  API_URL: "https://example.test/api"
}));

jest.mock("@/stores/session", () => ({
  useSessionStore: {
    getState: () => ({ token: "test-token" })
  }
}));

jest.mock("@/lib/query-client", () => ({
  queryClient: { clear: jest.fn() }
}));

describe("uploadImage (native)", () => {
  beforeEach(() => {
    jest.resetModules();
    mockUpload.mockReset();
    mockWrite.mockReset();
    mockDelete.mockReset();
    mockExists.mockReturnValue(true);
    jest.doMock("react-native", () => ({
      Platform: { OS: "ios" }
    }));
  });

  it("uploads via expo-file-system multipart on native", async () => {
    const payload: UploadSlim = {
      id: 9,
      name: "cover.jpg",
      url: "/uploads/2/cover.jpg",
      file_path: "uploads/2/cover.jpg",
      created_on: "2026-08-25T00:00:00Z",
      created_by_id: 1
    };
    mockUpload.mockResolvedValue({
      status: 200,
      body: JSON.stringify(payload),
      headers: {}
    });

    const { uploadImage } = require("../uploads") as typeof import("../uploads");
    const result = await uploadImage({
      uri: "file:///tmp/cover.jpg",
      fileName: "cover.jpg",
      mimeType: "image/jpeg"
    });

    expect(result).toEqual(payload);
    expect(mockUpload).toHaveBeenCalledWith("https://example.test/api/upload/", {
      httpMethod: "POST",
      uploadType: 1,
      fieldName: "file",
      mimeType: "image/jpeg",
      sessionType: "foreground",
      headers: { Authorization: "Bearer test-token" }
    });
  });

  it("surfaces a readable error when the picked file is missing", async () => {
    mockExists.mockReturnValue(false);
    const { uploadImage } = require("../uploads") as typeof import("../uploads");

    await expect(
      uploadImage({ uri: "file:///tmp/missing.jpg", fileName: "missing.jpg" })
    ).rejects.toMatchObject({
      userMessage: "Could not read the selected photo. Try choosing a different image."
    });
  });

  it("writes a clipboard data URI to a temporary file before uploading and cleans it up", async () => {
    const payload: UploadSlim = {
      id: 11,
      name: "clipboard.png",
      url: "/uploads/2/clipboard.png",
      file_path: "uploads/2/clipboard.png",
      created_on: "2026-08-25T00:00:00Z",
      created_by_id: 1
    };
    mockUpload.mockResolvedValue({
      status: 200,
      body: JSON.stringify(payload),
      headers: {}
    });

    const { uploadImage } = require("../uploads") as typeof import("../uploads");
    const result = await uploadImage({
      uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      fileName: "clipboard.png",
      mimeType: "image/png"
    });

    expect(result).toEqual(payload);
    expect(mockWrite).toHaveBeenCalledWith("iVBORw0KGgoAAAANSUhEUg==", { encoding: "base64" });
    expect(mockUpload).toHaveBeenCalledWith("https://example.test/api/upload/", {
      httpMethod: "POST",
      uploadType: 1,
      fieldName: "file",
      mimeType: "image/png",
      sessionType: "foreground",
      headers: { Authorization: "Bearer test-token" }
    });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
