import { normalizeCoverOption, uploadMediaUrl } from "../coverMedia";

describe("uploadMediaUrl", () => {
  it("keeps an existing url", () => {
    expect(uploadMediaUrl({ url: "/uploads/2/photo.jpg", file_path: "2/photo.jpg" })).toBe(
      "/uploads/2/photo.jpg"
    );
  });

  it("derives url from file_path when url is missing", () => {
    expect(uploadMediaUrl({ url: "", file_path: "2/photo.jpg" })).toBe("/uploads/2/photo.jpg");
  });
});

describe("normalizeCoverOption", () => {
  it("fills url on cover candidates returned without the computed field", () => {
    const option = normalizeCoverOption({
      id: 9,
      name: "cover",
      url: "",
      file_path: "2/test.webp",
      created_on: "2026-08-25T00:00:00Z",
      created_by_id: 1,
      skip_key: "ov:abc"
    });
    expect(option.url).toBe("/uploads/2/test.webp");
  });
});
