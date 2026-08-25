import { normalizePickedImage } from "../imageUpload";

describe("normalizePickedImage", () => {
  it("fills in a filename when the picker omits one", () => {
    const result = normalizePickedImage({
      uri: "file:///tmp/photo",
      fileName: null,
      mimeType: "image/jpeg"
    });
    expect(result.fileName).toMatch(/^photo-\d+\.jpg$/);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("treats empty string filename as missing", () => {
    const result = normalizePickedImage({
      uri: "file:///tmp/photo",
      fileName: "   ",
      mimeType: "image/png"
    });
    expect(result.fileName).toMatch(/^photo-\d+\.png$/);
    expect(result.mimeType).toBe("image/png");
  });

  it("keeps a real filename and adds an extension when needed", () => {
    const result = normalizePickedImage({
      uri: "file:///tmp/photo",
      fileName: "IMG_001",
      mimeType: "image/heic"
    });
    expect(result.fileName).toBe("IMG_001.heic");
    expect(result.mimeType).toBe("image/heic");
  });
});
