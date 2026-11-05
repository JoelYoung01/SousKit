import {
  applySourceLinkInput,
  hostnameLabel,
  parseSourceLinkInput,
  siteNameFromHtml
} from "../sourceLinks";

describe("source links", () => {
  it("parses a comma-separated list of URLs", () => {
    expect(parseSourceLinkInput("https://a.example/1, https://b.example/2")).toEqual([
      { name: "", url: "https://a.example/1" },
      { name: "", url: "https://b.example/2" }
    ]);
  });

  it("pairs a pasted name with a single URL", () => {
    expect(parseSourceLinkInput("Serious Eats, https://www.seriouseats.com/chili")).toEqual([
      { name: "Serious Eats", url: "https://www.seriouseats.com/chili" }
    ]);
  });

  it("holds a bare name until the next URL", () => {
    expect(applySourceLinkInput("Serious Eats", "")).toEqual({
      additions: [],
      pendingName: "Serious Eats"
    });
    expect(applySourceLinkInput("https://www.seriouseats.com/chili", "Serious Eats").additions).toEqual([
      {
        name: "Serious Eats",
        url: "https://www.seriouseats.com/chili",
        autoName: false
      }
    ]);
  });

  it("labels a URL with the hostname until the page is read", () => {
    expect(hostnameLabel("https://www.the-kitchn.com/soup")).toBe("The Kitchn");
    expect(applySourceLinkInput("https://www.seriouseats.com/chili", "").additions[0]).toMatchObject({
      name: "Seriouseats",
      autoName: true
    });
  });

  it("reads the website name from the page", () => {
    const html =
      '<meta property="og:site_name" content="Serious Eats"><title>Best Chili | Serious Eats</title>';
    expect(siteNameFromHtml(html, "https://www.seriouseats.com/chili")).toBe("Serious Eats");
  });

  it("returns null when the page does not name the site", () => {
    expect(siteNameFromHtml("<title>Best Chili</title>", "https://www.seriouseats.com/chili")).toBeNull();
  });
});
