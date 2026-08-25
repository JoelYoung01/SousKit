import { defaultUploadFileName, inferImageMimeType } from "../upload-media";

describe("inferImageMimeType", () => {
  it("prefers the picker mime type", () => {
    expect(inferImageMimeType("photo.jpg", "image/png")).toBe("image/png");
  });

  it("infers from the file extension", () => {
    expect(inferImageMimeType("cover.heic", null)).toBe("image/heic");
    expect(inferImageMimeType("cover.png", undefined)).toBe("image/png");
  });

  it("falls back to jpeg", () => {
    expect(inferImageMimeType("photo", null)).toBe("image/jpeg");
  });
});

describe("defaultUploadFileName", () => {
  it("uses the picker file name when present", () => {
    expect(defaultUploadFileName("My Recipe.jpg", null)).toBe("My Recipe.jpg");
  });

  it("generates a timestamped jpeg name", () => {
    expect(defaultUploadFileName(null, null)).toMatch(/^photo-\d+\.jpg$/);
  });

  it("uses the mime type extension when fileName is missing", () => {
    expect(defaultUploadFileName(null, "image/png")).toMatch(/^photo-\d+\.png$/);
  });
});
