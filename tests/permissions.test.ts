import { describe, expect, it } from "vitest";
import { atLeast, resolveRole, wouldCreateCycle, type AncestorPage } from "@/lib/permissions";

const page = (id: string, extra: Partial<AncestorPage> = {}): AncestorPage => ({
  id,
  ownerId: "owner",
  publicAccess: "none",
  archived: false,
  ...extra,
});

describe("resolveRole", () => {
  const path = [page("child"), page("parent"), page("root")];

  it("gives the owner full access", () => {
    expect(resolveRole(path, "owner", [])).toBe("owner");
  });

  it("denies strangers and anonymous visitors", () => {
    expect(resolveRole(path, "stranger", [])).toBeNull();
    expect(resolveRole(path, null, [])).toBeNull();
  });

  it("inherits a share from an ancestor", () => {
    expect(resolveRole(path, "bob", [{ pageId: "root", userId: "bob", role: "view" }])).toBe("view");
  });

  it("uses the strongest share along the path", () => {
    const shares = [
      { pageId: "root", userId: "bob", role: "view" as const },
      { pageId: "parent", userId: "bob", role: "edit" as const },
    ];
    expect(resolveRole(path, "bob", shares)).toBe("edit");
  });

  it("ignores shares on other pages and for other people", () => {
    const shares = [
      { pageId: "elsewhere", userId: "bob", role: "edit" as const },
      { pageId: "root", userId: "carol", role: "edit" as const },
    ];
    expect(resolveRole(path, "bob", shares)).toBeNull();
  });

  it("lets anyone view below a public page", () => {
    const publicPath = [page("child"), page("parent", { publicAccess: "view" })];
    expect(resolveRole(publicPath, null, [])).toBe("view");
    expect(resolveRole(publicPath, "bob", [{ pageId: "child", userId: "bob", role: "edit" }])).toBe("edit");
  });

  it("hides pages under a trashed ancestor from everyone but the owner", () => {
    const trashed = [page("child"), page("parent", { archived: true, publicAccess: "view" })];
    expect(resolveRole(trashed, "bob", [{ pageId: "child", userId: "bob", role: "edit" }])).toBeNull();
    expect(resolveRole(trashed, null, [])).toBeNull();
    expect(resolveRole(trashed, "owner", [])).toBe("owner");
  });
});

describe("helpers", () => {
  it("compares roles", () => {
    expect(atLeast("owner", "edit")).toBe(true);
    expect(atLeast("view", "edit")).toBe(false);
    expect(atLeast(null, "view")).toBe(false);
  });

  it("detects moves into a descendant", () => {
    expect(wouldCreateCycle("a", ["c", "b", "a"])).toBe(true);
    expect(wouldCreateCycle("a", ["x", "y"])).toBe(false);
  });
});
