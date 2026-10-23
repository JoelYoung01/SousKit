import {
  defaultUploadFileName,
  inferImageMimeType,
  normalizeClipboardImageData,
  parseImageDataUri
} from "../upload-media";

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

describe("parseImageDataUri", () => {
  it("parses a base64 png data URI", () => {
    const parsed = parseImageDataUri("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    expect(parsed).toEqual({
      dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      mimeType: "image/png",
      extension: "png",
      base64: "iVBORw0KGgoAAAANSUhEUg=="
    });
  });

  it("normalizes image/jpg to image/jpeg", () => {
    const parsed = parseImageDataUri("data:image/jpg;base64,iVBORw0KGgoAAAANSUhEUg==");
    expect(parsed?.mimeType).toBe("image/jpeg");
    expect(parsed?.extension).toBe("jpg");
  });

  it("returns null for non-image or plain strings", () => {
    expect(parseImageDataUri("https://example.com/photo.jpg")).toBeNull();
    expect(parseImageDataUri("data:text/plain;base64,SGVsbG8=")).toBeNull();
    expect(parseImageDataUri("")).toBeNull();
  });
});

describe("normalizeClipboardImageData", () => {
  it("wraps raw base64 strings into a data URI", () => {
    const parsed = normalizeClipboardImageData("iVBORw0KGgoAAAANSUhEUg==");
    expect(parsed).toEqual({
      dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      mimeType: "image/png",
      extension: "png",
      base64: "iVBORw0KGgoAAAANSUhEUg=="
    });
  });
});
