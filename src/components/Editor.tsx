"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef } from "react";
import type { EditorBlock } from "@/lib/blocks";

type Props = {
  pageId: string;
  initialBlocks: EditorBlock[];
  editable: boolean;
  onSaveState: (state: "saving" | "saved" | "error") => void;
};

const SAVE_DELAY_MS = 600;

export default function Editor({ pageId, initialBlocks, editable, onSaveState }: Props) {
  const editor = useCreateBlockNote({
    initialContent: initialBlocks.length ? (initialBlocks as PartialBlock[]) : undefined,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => Promise<void>) | null>(null);

  // Flush a pending save when leaving the page.
  useEffect(() => {
    const flush = () => pending.current?.();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, []);

  function scheduleSave() {
    if (!editable) return;
    onSaveState("saving");
    const save = async () => {
      pending.current = null;
      const res = await fetch(`/api/pages/${pageId}/blocks`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blocks: editor.document }),
        keepalive: true,
      }).catch(() => null);
      onSaveState(res?.ok ? "saved" : "error");
    };
    pending.current = save;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }

  return <BlockNoteView editor={editor} editable={editable} onChange={scheduleSave} theme="light" />;
}
