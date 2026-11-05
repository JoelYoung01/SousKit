import { markdownToPlain, parseMarkdown } from "../markdown";

describe("parseMarkdown", () => {
  it("keeps plain text and hard line breaks", () => {
    expect(parseMarkdown("Heat the oil.\nAdd the onion.")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Heat the oil." },
          { type: "break" },
          { type: "text", text: "Add the onion." }
        ]
      }
    ]);
  });

  it("renders bold, italic, code, and safe links", () => {
    expect(parseMarkdown("Whisk the **butter** and *salt*. See [notes](https://example.com/a).")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Whisk the " },
          { type: "strong", children: [{ type: "text", text: "butter" }] },
          { type: "text", text: " and " },
          { type: "em", children: [{ type: "text", text: "salt" }] },
          { type: "text", text: ". See " },
          {
            type: "link",
            href: "https://example.com/a",
            children: [{ type: "text", text: "notes" }]
          },
          { type: "text", text: "." }
        ]
      }
    ]);
    expect(parseMarkdown("Use `1 tsp` salt.")[0]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "text", text: "Use " },
        { type: "code", text: "1 tsp" },
        { type: "text", text: " salt." }
      ]
    });
  });

  it("leaves unsafe links as text and ignores mid-word underscores", () => {
    const unsafe = parseMarkdown("[click](javascript:alert(1)) the file_name.");
    expect(JSON.stringify(unsafe)).not.toContain('"type":"link"');
    expect(unsafe[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", text: "[click](javascript:alert(1)) the file_name." }]
    });
  });

  it("parses headings and nested lists", () => {
    expect(
      parseMarkdown("## Sauce\n\n1. Whisk.\n2. Simmer.\n\n- Rest overnight\n  - or freeze\n- Serve warm")
    ).toEqual([
      { type: "heading", level: 2, children: [{ type: "text", text: "Sauce" }] },
      {
        type: "list",
        ordered: true,
        start: 1,
        items: [
          { children: [{ type: "text", text: "Whisk." }], nested: null },
          { children: [{ type: "text", text: "Simmer." }], nested: null }
        ]
      },
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          {
            children: [{ type: "text", text: "Rest overnight" }],
            nested: {
              type: "list",
              ordered: false,
              start: 1,
              items: [{ children: [{ type: "text", text: "or freeze" }], nested: null }]
            }
          },
          { children: [{ type: "text", text: "Serve warm" }], nested: null }
        ]
      }
    ]);
  });

  it("flattens formatting for compact previews", () => {
    expect(markdownToPlain("A **hearty** bowl.\n\n- Rest *overnight*")).toBe(
      "A hearty bowl. Rest overnight"
    );
  });
});
