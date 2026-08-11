import { buildInviteUrl, extractInviteToken, inviteLabel, resolveInviteUrl } from "../household-invite";

describe("extractInviteToken", () => {
  it("parses https join paths", () => {
    expect(extractInviteToken("https://sous-kit.com/join/abc123XYZ_-")).toBe(
      "abc123XYZ_-"
    );
  });

  it("parses souskit custom-scheme URLs", () => {
    expect(extractInviteToken("souskit://join/tok_value99")).toBe("tok_value99");
  });

  it("parses relative join paths and query tokens", () => {
    expect(extractInviteToken("/join/relToken01")).toBe("relToken01");
    expect(extractInviteToken("https://example.com/join?token=queryTok01")).toBe("queryTok01");
  });

  it("accepts raw tokens and rejects junk", () => {
    expect(extractInviteToken("plainToken_123456")).toBe("plainToken_123456");
    expect(extractInviteToken("nope")).toBeNull();
    expect(extractInviteToken("")).toBeNull();
  });
});

describe("resolveInviteUrl / buildInviteUrl", () => {
  it("prefers server invite_url", () => {
    expect(
      resolveInviteUrl({ invite_url: "https://example.com/join/x", token: "x" })
    ).toBe("https://example.com/join/x");
  });

  it("builds from token when invite_url missing", () => {
    expect(resolveInviteUrl({ token: "abc" })).toBe(buildInviteUrl("abc"));
    expect(buildInviteUrl("abc")).toMatch(/\/join\/abc$/);
  });
});

describe("inviteLabel", () => {
  it("uses email when present, otherwise link expiry", () => {
    expect(inviteLabel({ email: "a@b.com", expires_on: "2026-08-20T00:00:00Z" })).toBe(
      "a@b.com"
    );
    expect(inviteLabel({ email: null, expires_on: "2026-08-20T00:00:00Z" })).toMatch(
      /^Link · expires /
    );
  });
});
