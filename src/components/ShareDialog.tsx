"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";

type Share = { userId: string; email: string; name: string; role: "view" | "edit" };

export function ShareDialog({
  pageId,
  publicAccess,
  onClose,
}: {
  pageId: string;
  publicAccess: "none" | "view";
  onClose: () => void;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [isPublic, setIsPublic] = useState(publicAccess === "view");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"view" | "edit">("edit");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/p/${pageId}`;

  useEffect(() => {
    fetch(`/api/pages/${pageId}/shares`)
      .then((r) => r.json())
      .then((d) => setShares(d.shares ?? []));
  }, [pageId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/pages/${pageId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setShares(data.shares);
    setEmail("");
  }

  async function update(userId: string, email: string, newRole: "view" | "edit" | "remove") {
    const res =
      newRole === "remove"
        ? await fetch(`/api/pages/${pageId}/shares?userId=${userId}`, { method: "DELETE" })
        : await fetch(`/api/pages/${pageId}/shares`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, role: newRole }),
          });
    if (res.ok) setShares((await res.json()).shares);
  }

  async function togglePublic(next: boolean) {
    setIsPublic(next);
    await fetch(`/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicAccess: next ? "view" : "none" }),
    });
  }

  return (
    <Modal title="Share" onClose={onClose}>
      <form className="share-invite" onSubmit={invite}>
        <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select value={role} onChange={(e) => setRole(e.target.value as "view" | "edit")} aria-label="Role">
          <option value="edit">Can edit</option>
          <option value="view">Can view</option>
        </select>
        <button className="btn btn-primary">Invite</button>
      </form>
      {error && <p className="form-error">{error}</p>}

      <ul className="share-list">
        {shares.map((s) => (
          <li key={s.userId}>
            <span>
              <strong>{s.name}</strong> <span className="muted">{s.email}</span>
            </span>
            <select
              value={s.role}
              onChange={(e) => update(s.userId, s.email, e.target.value as "view" | "edit" | "remove")}
              aria-label={`Role for ${s.email}`}
            >
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
              <option value="remove">Remove</option>
            </select>
          </li>
        ))}
      </ul>
      <p className="muted small">People you invite also get access to every page inside this one.</p>

      <div className="share-public">
        <label>
          <input type="checkbox" checked={isPublic} onChange={(e) => togglePublic(e.target.checked)} />
          Anyone with the link can view
        </label>
        {isPublic && (
          <div className="share-link">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Public link" />
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard?.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
