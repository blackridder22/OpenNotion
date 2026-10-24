# Studying Notion with REA

[REA](https://github.com/blackridder22/rea) is a reverse-engineering toolkit that can analyze JavaScript applications, Electron apps, and saved network captures. This note records what it was used for while building phase 1, what it could not do, and how to take it further.

Everything here is about observing behavior and public data shapes. OpenNotion does not copy Notion code or assets.

## What was done

The build ran in a cloud sandbox that cannot reach `notion.so`, so Notion's live web app, its JavaScript bundles, and its desktop installer were out of reach. REA was instead pointed at two public npm packages that talk to Notion's (unofficial) internal API:

- `notion-client@8.0.8`, a client for Notion's private `api/v3` endpoints
- `notion-types@8.0.8`, TypeScript types for the records those endpoints return

```bash
npm pack notion-client@8.0.8 notion-types@8.0.8
npx -y rea-agents@latest analyze-javascript-application /abs/path/notion-client-8.0.8/package --json > notion-client.evidence.json
```

REA produced an application graph (modules, imports, source-map links) for the client, which made it quick to find the request layer and the record types it parses.

## What was learned

**Everything is a block record.** Notion stores pages and content in one `block` table. Each record has:

| Field | Meaning |
| --- | --- |
| `id` | UUID |
| `type` | `page`, `text`, `header`, `bulleted_list`, `to_do`, `toggle`, `code`, `image`, `collection_view`, and about 40 more |
| `properties` | the block's text and values, e.g. `title` as rich-text runs |
| `format` | presentation, e.g. `block_color`, page icon and cover |
| `content` | ordered list of child block ids |
| `parent_id`, `parent_table` | the parent record and which table it lives in (`block`, `space`, `collection`) |
| `space_id` | the workspace |
| `alive` | `false` when deleted (soft delete) |
| `version`, `created_time`, `last_edited_time`, `created_by_*`, `last_edited_by_*` | bookkeeping |

A page is just a block of type `page` whose `content` lists its top-level blocks; a sub-page is a `page` block inside another page's content.

**Internal endpoints seen in the client:** `loadPageChunk` (load a page's blocks in chunks), `syncRecordValuesMain` / `getRecordValues` (fetch records by id), `queryCollection` (database queries), `search`, and `getSignedFileUrls` (temporary URLs for uploaded files).

## How OpenNotion maps to it

| Notion | OpenNotion phase 1 |
| --- | --- |
| `block` with `type: "page"` | `pages` row, tree via `parent_id` |
| content blocks | `blocks` rows, nesting via `parent_id`, order via `position` (instead of a `content` id array on the parent) |
| `properties.title` | `pages.title`, block `content` (BlockNote inline content) |
| `format.page_icon` | `pages.icon` |
| `alive: false` / trash | `pages.archived_at` |
| `space_id` and space permissions | not yet: pages belong to a user; workspaces come later |
| page permissions inherited down the tree | `page_shares` plus `public_access`, resolved up the ancestor path |

Ordering is kept on the child (`position`) rather than as an id array on the parent, which avoids rewriting the parent on every insert. It is the main deliberate difference.

## What REA could not do here

- No live capture of notion.so: the sandbox's network blocks it, so no HAR file, no runtime observation, and no look at the real web bundles.
- No Notion desktop app analysis: the installer could not be downloaded.
- The npm packages are community reverse-engineering, not Notion's own code, so they show the data shapes but not server behavior such as permission checks or conflict handling.

## Going further on your own machine

REA runs locally, so these work from your computer where Notion is reachable:

1. **Network capture of the web app.** In Chrome, open DevTools, Network tab, use Notion for a minute (open a page, type, share, move a block), then right-click and "Save all as HAR with content". Then:

   ```bash
   npx -y rea-agents@latest inspect-web-network-capture /abs/path/notion.har har --json > notion-har.json
   ```

   That shows the real `api/v3` calls, including the ones that save edits, which is what phase 2 (live sync) needs to learn from.

2. **The desktop app.** The Notion desktop app is Electron. After installing it, point REA at the app folder (on macOS `/Applications/Notion.app`):

   ```bash
   npx -y rea-agents@latest analyze-javascript-application /Applications/Notion.app --json > notion-desktop.json
   ```

Keep captures private: a HAR file contains your session cookies and page content.
