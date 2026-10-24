import { describe, expect, it } from "vitest";
import { buildBlockTree, flattenBlocks, type EditorBlock } from "@/lib/blocks";

const doc: EditorBlock[] = [
  { id: "a", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Title", styles: {} }], children: [] },
  {
    id: "b",
    type: "bulletListItem",
    props: {},
    content: [],
    children: [
      { id: "c", type: "paragraph", props: {}, content: [], children: [] },
      { id: "d", type: "paragraph", props: {}, content: [], children: [{ id: "e", type: "paragraph", props: {}, content: [], children: [] }] },
    ],
  },
];

describe("flattenBlocks", () => {
  it("records parent and sibling position for every block", () => {
    const rows = flattenBlocks(doc);
    expect(rows.map((r) => [r.id, r.parentId, r.position])).toEqual([
      ["a", null, 0],
      ["b", null, 1],
      ["c", "b", 0],
      ["d", "b", 1],
      ["e", "d", 0],
    ]);
  });

  it("rejects duplicate ids", () => {
    expect(() => flattenBlocks([doc[0], doc[0]])).toThrow(/Duplicate/);
  });
});

describe("buildBlockTree", () => {
  it("round-trips the editor document", () => {
    expect(buildBlockTree(flattenBlocks(doc))).toEqual(doc);
  });

  it("orders siblings by position regardless of row order", () => {
    const rows = flattenBlocks(doc).reverse();
    expect(buildBlockTree(rows).map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("drops rows whose parent is missing", () => {
    const rows = flattenBlocks(doc).filter((r) => r.id !== "b");
    expect(buildBlockTree(rows).map((b) => b.id)).toEqual(["a"]);
  });
});
