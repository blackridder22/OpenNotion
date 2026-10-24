// Converts between the editor's nested document and the flat rows stored in
// the blocks table. Kept free of database and editor imports so it can be
// unit tested and used on both sides.

export type EditorBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: EditorBlock[];
};

export type BlockRow = {
  id: string;
  parentId: string | null;
  position: number;
  type: string;
  props: Record<string, unknown>;
  content: unknown;
};

export function flattenBlocks(doc: EditorBlock[], parentId: string | null = null): BlockRow[] {
  const rows: BlockRow[] = [];
  const seen = new Set<string>();
  const walk = (list: EditorBlock[], parent: string | null) => {
    list.forEach((block, position) => {
      if (seen.has(block.id)) throw new Error(`Duplicate block id ${block.id}`);
      seen.add(block.id);
      rows.push({
        id: block.id,
        parentId: parent,
        position,
        type: block.type,
        props: block.props ?? {},
        content: block.content ?? null,
      });
      if (block.children?.length) walk(block.children, block.id);
    });
  };
  walk(doc, parentId);
  return rows;
}

export function buildBlockTree(rows: BlockRow[]): EditorBlock[] {
  const byParent = new Map<string | null, BlockRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const build = (parent: string | null, path: Set<string>): EditorBlock[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => a.position - b.position)
      .filter((row) => !path.has(row.id))
      .map((row) => {
        const block: EditorBlock = { id: row.id, type: row.type, props: row.props, children: [] };
        if (row.content !== null && row.content !== undefined) block.content = row.content;
        block.children = build(row.id, new Set(path).add(row.id));
        return block;
      });
  return build(null, new Set());
}
