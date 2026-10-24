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

## What REA could not do in the first pass

- No live capture of notion.so: the sandbox's network blocks it, so no HAR file, no runtime observation, and no look at the real web bundles.
- No Notion desktop app analysis: the installer could not be downloaded.
- The npm packages are community reverse-engineering, not Notion's own code, so they show the data shapes but not server behavior such as permission checks or conflict handling.

## Live capture of the web app (October 2026)

The first pass above only had community npm packages to go on. This pass watched the real web app in Chrome, logged in, on a throwaway private page, with two tabs open on the same page so one tab could watch the other's edits arrive. Every `/api/v3` call and every websocket frame in both directions was recorded with the scripts in [`docs/capture/`](capture/) (see "Rerunning the capture" below). The scenarios were: create a page, type a title and a paragraph, append text, a heading via `## `, a to-do via `[] `, indent with Tab, tick a checkbox from the other tab, both tabs typing into the same paragraph at once, delete a nested block with Backspace, a simulated network outage while typing, and navigating away and back. A second session added drag-to-move, undo and redo, a comment and resolving it, an inline database (property, row, select value, sort), an image upload, and opening the share menu.

Client version at capture time: `notion-client-version: 23.13.20261024.1856`.

### The short version for phase 2

1. **Writes are HTTP, not websocket.** Every edit is a `POST /api/v3/saveTransactionsFanout` carrying a batch of small transactions. The response body is just `{}`.
2. **The websocket only says "something changed".** The server pushes `versions/<blockId>:block` with the new version number, and the other client then pulls the record over HTTP with `syncRecordValuesSpaceInitial`. No document content ever travels over the socket.
3. **Text is a CRDT.** Notion is migrating block text from the old rich-text arrays to a sequence CRDT (`crdt_data`, `crdt_format_version: 1`). Each keystroke is an `insertText` op with a `[clientId, clock]` id and an origin id, much like Yjs items. Concurrent typing in the same paragraph merged cleanly in both tabs.
4. **Structure is plain last-writer ops.** Creating, moving, indenting and deleting blocks are `set`, `update`, `listAfter` and `listRemove` operations on block records, not CRDT ops.
5. **Presence is per block, not per character.** The socket carries "user X is on block Y", refreshed about once a second while typing. There were no remote text cursors in the frames.

So Notion today is a hybrid: CRDT for text inside a block, server-ordered operations for the block tree, and the socket as an invalidation channel. That maps well onto Yjs + Hocuspocus if OpenNotion keeps the same split (see "What this means for OpenNotion" below).

### Hosts and transports

| Host | What it does |
| --- | --- |
| `app.notion.com/api/v3/*` | All reads and writes, JSON over `POST`. The app moved from `www.notion.so` to `app.notion.com`. |
| `msgstore-NNN.app.notion.com/primus-v8/` | Realtime channel. Primus over Engine.IO v4 (`EIO=4`): starts with HTTP long-polling, upgrades to a websocket. |
| `exp.notion.com` | Feature flags (Statsig). |
| `app.notion.com/_assets/wasm-sqlite-*worker*.js`, `opfs-page-cache-worker` | Client-side SQLite (WASM) in shared/dedicated workers, plus an OPFS page cache. Pages render from this local cache first, then revalidate over the network. |

Requests carry `x-notion-active-user-header` (the user id), `x-notion-space-id`, `notion-client-version`, `notion-audit-log-platform: web`, and `x-notion-cell-hint: prod-space-usw2-0002` with `x-notion-cell-hint-source: space-short-id-mapping`. The cell hint suggests the backend is sharded into "cells" and each workspace is pinned to one; the client tells the load balancer which cell to route to.

### Page load

Observed on a cold load, in order: `getSpacesInitial`, `loadCachedPageChunkV2` (blocks for the current page, served from cache when possible), `queryCollection?src=initial_load` (when the page is a database), `getAppConfig`, `getSpacesFanout`, `syncRecordValuesMain`, `syncRecordValuesSpaceInitial`, then the realtime socket opens. Opening a page also calls `recordPageVisit`/`recordPageExit`, `getPageVisitors`, `getBacklinksForBlockInitial` and `getPresenceAuthorizationToken`.

`loadPageChunk` and `loadCachedPageChunkV2` take `{ page: { id }, limit, cursor: { stack: [] }, verticalColumns }` and return a `recordMap`:

```json
{
  "cursor": { "stack": [] },
  "recordMap": {
    "__version__": 3,
    "block": {
      "<blockId>": { "spaceId": "<spaceId>", "value": { "value": { "id": "...", "version": 23, "type": "text", "...": "..." }, "role": "editor" } }
    }
  }
}
```

Note the double `value.value`: the outer object carries the caller's `role` next to the record. `getRecordValues` returns the same records plus a `recordMapWithRoles`, and pulls in the parent `space` record too.

### Block records now

The fields from the first pass are all still there. New since then:

| Field | Meaning |
| --- | --- |
| `crdt_data` | CRDT state for each text property, keyed by property name (`title` for the block's text) |
| `crdt_format_version` | `1` |
| `nav_parent_id`, `nav_parent_table` | the parent used for navigation and breadcrumbs, set alongside `parent_id` |
| `permissions` | on top-level private pages: `[{ "type": "user_permission", "role": "editor", "user_id": "..." }]` |

`properties.title` (the old `[["text", [formatting]]]` runs) is still returned, and matches the CRDT text, so the server keeps both in sync during the migration. The workspace record has `settings.crdt_status: "migrating"`.

### The text CRDT

A block's `crdt_data.title` after "Hello sync" was typed in tab A and " from B BBB" appended from tab B, and "AAA " typed at the start from tab A at the same moment:

```json
{
  "r": "5FfD...,\"start\",\"end\"",
  "n": {
    "5FfD...,\"start\",\"end\"": {
      "s": {
        "x": "5FfD...",
        "i": [
          { "t": "s" },
          { "t": "t", "i": ["AA1s...", 18], "o": "start", "l": 4, "c": "AAA " },
          { "t": "t", "i": ["AA1s...", 1], "o": "start", "l": 10, "c": "Hello sync" },
          { "t": "t", "i": ["FWRE...", 11], "o": ["AA1s...", 10], "l": 11, "c": " from B BBB" },
          { "t": "e" }
        ],
        "l": ""
      },
      "c": []
    }
  }
}
```

Reading it:

- `x` is a **text instance id**, one per text property per block, also sent as `textInstanceId` in ops.
- `i` is the item list, bracketed by start (`s`) and end (`e`) sentinels. Text items (`t: "t"`) are run-length encoded: `i` is the id of the first character as `[clientId, clock]`, `l` is the run length, `c` the content, and `o` the **origin**: the id of the character it was inserted after (or `"start"`). This is the YATA/RGA shape Yjs uses.
- `clientId` is per tab, not per user: both tabs were the same user and got different ids (`AA1s...` and `FWRE...`).
- Deleted runs stay as tombstones with a negative length and no content: `{ "t": "t", "i": ["FWRE...", 1], "o": "start", "l": -3 }` is the `## ` that the heading shortcut removed.
- `r`/`n` look like a tree of nested text nodes keyed by path; `c: []` would hold children (probably inline sub-documents). Only the single-node case was seen.

### Operations seen in `saveTransactionsFanout`

Body: `{ requestId, transactions: [{ id, spaceId, debug: { userAction, clientCommitTimeMs, ... }, operations: [...] }] }`. Each operation is `{ pointer: { table, id, spaceId }, path, command, args }`. `debug.userAction` names the UI action (`Text.handleMutation`, `Text.handleEnter`, `textFilterActions.runAllFiltersAfterTransaction`, `sidebarActions.quickAddPage.directMoveToAdd`).

| Action | Operations |
| --- | --- |
| **New page** | `block set []` with `id, type: "page", space_id, created_*, last_edited_time, crdt_data` (empty title), then `update` `permissions`, `update` `parent_id/parent_table/alive`, `space_view listBefore ["private_pages"]` to put it in the sidebar, then a `last_edited_*` update |
| **Type a character** | `block insertText []` with `{ textInstanceId, id: [clientId, clock], originId, content, prevItems }` plus `update last_edited_*` on the block and on the page. One transaction per keystroke, many transactions per request. |
| **Delete characters** | `block deleteText []` with `{ textInstanceId, idRanges: [[[clientId, clock], length]] }` |
| **Enter (new block)** | `block set` (new `text` block with empty `crdt_data`), `update parent_id/parent_table/alive`, `block listAfter ["content"] { after, id }` on the parent |
| **Markdown shortcut** (`## `, `[] `) | `update { type: "sub_header" }` or `{ type: "to_do" }`, then `deleteText` of the typed prefix |
| **Indent (Tab)** | in one transaction: `update { alive: false }`, `listRemove ["content"] { id }` on the old parent, `update { parent_id, parent_table, alive: true }`, `listAfter ["content"] { id }` on the new parent |
| **Backspace on an empty nested block** | first outdents (the indent sequence in reverse), then merges into the block above with `splitText` + `moveTextSlice { targetBlockId, targetTextInstanceId, isMerge: true }`, then `alive: false` and `listRemove` |
| **Tick a to-do** | made in the unhooked tab, so the op itself was not captured; the watching tab got a version bump and the re-fetched record had `properties.checked: [["Yes"]]` (a plain property, not CRDT) |

`insertText` also carries `prevItems`: the items to the left of the cursor at the time of the edit. Probably so the server can place the insert even if it has not yet seen the origin item (inferred, not tested).

### How a change reaches the other tab

Tab B typing, as tab A saw it:

1. B sends `saveTransactionsFanout` (several keystrokes batched; typing 10 characters produced one request of 10 transactions).
2. Within about 100 ms the socket on A receives `{"type":"notification","key":"versions/<blockId>:block","value":58,"version":...}`, one per touched block (the edited block and its page).
3. A posts `syncRecordValuesSpaceInitial` with `{ requests: [{ pointer: { table: "block", id, spaceId }, version: 30 }], spacePointer }`, where `version` is the version it already has. The response is the **whole record** at the new version, not a diff. A merges the CRDT state locally.

A client subscribes to blocks over the socket as it renders them:

```text
-> 4{"type":"/api/v1/registerBatchSubscriptions","requestId":"...","subscriptions":[{"key":"versions/<blockId>:block","version":-1}]}
<- 4{"type":"response","status":"ok","requestId":"...","result":{"responses":[...]}}
<- 4{"type":"notification","key":"versions/<blockId>:block","value":3,"version":...}
-> 4{"type":"/api/v1/unregisterBatchSubscriptions","requestId":"...","keys":["..."]}
```

Other subscription keys seen: `presence/<pageId>`, `versions/<spaceId>:sidebar_preset:<id>`, `cron/events_updated/...` and `cron/calendar_*` (Notion Calendar), `transcription_block/<spaceId>/<userId>` (AI meeting notes).

Frame format: `4` is an Engine.IO message, wrapping a JSON Primus payload. Keepalives are Engine.IO `2`/`3` plus Primus-level `4"primus::ping::<ms>"` / `4"primus::pong::<ms>"`, about every 25 seconds.

### Presence

While a user is on a page, the client sends roughly once a second during activity:

```json
{
  "type": "/api/v1/updateField",
  "key": "presence/<pageId>",
  "field": "<userId>",
  "updates": { "userId": "...", "present": true, "activityTimestampNearestMinuteMs": 1792882740000, "blockId": "<blockId>", "blockPath": ["<pageId>", "<blockId>"] },
  "ttl": 3600000,
  "onDisconnectFields": { "presenceOnDisconnectFlag": "register", "subscriptionId": "...", "pageVisitId": "...", "spaceId": "...", "pageId": "..." },
  "authorizationToken": "v1:<expiryMs>:<userId>:<signature>"
}
```

The token comes from `getPresenceAuthorizationToken` over HTTP, so the realtime service can trust the user id without its own session lookup. Everyone subscribed to `presence/<pageId>` gets a notification with the whole map of present users. The server clears the entry on disconnect (`onDisconnectFields`) and after the TTL. Presence is at block level: no character offsets or selections were sent.

### Offline and retry

With `saveTransactions` forced to fail for 10 seconds while typing a new block, the client kept editing locally, retried about every 5 seconds, and on recovery sent everything in one request (about 20 KB, every keystroke transaction kept). Tab A then received the version notifications and showed the text. Nothing was lost and no conflict UI appeared.

### Drag to move, undo and redo

**Drag a block** (`userAction: ListItemBlock.handleDrop`): `update { alive: false }`, `listRemove ["content"] { id }`, then `insertChildrenAfter ["content"] { ids: [id], after }` on the target parent. `insertChildrenAfter` takes a list of ids, so a multi-block drag is presumably one op.

**Undo** (`cmd+z`) does not replay history on the server. The client builds an inverse transaction and sends it like any other edit, flagged with `isUndoTransaction: true` and `userAction: revisionActions.performUndoRedoRevisionTransaction`:

- Undoing the drag sent `removeChild ["content"]`, `listAfter ["content"] { id, after: <original neighbour> }` and `update { alive: true }`.
- Undoing typed text sent one `deleteText` per character, by CRDT id, newest first. Redo re-sent the characters as `insertText`.

So undo is local and per client: each tab only undoes its own edits, and the server just sees normal ops.

### Comments

Selecting a word and adding a comment sends one transaction (`newDiscussionMenuActions.submitNewDiscussion`) that touches five record types:

| Op | Meaning |
| --- | --- |
| `block addAnnotation { textInstanceId, id, start: { id, anchor: "before" }, end: { id, anchor: "after" }, annotation: ["m", <discussionId>] }` | marks the commented range inside the CRDT text, anchored to character ids, so the highlight survives edits around it |
| `discussion update { type: "default", parent_id: <blockId>, parent_table: "block", resolved: false, context: [["Hello", [["m", <discussionId>]]]], space_id }` | the thread; `context` keeps a snapshot of the quoted text |
| `comment set { id, parent_id: <discussionId>, parent_table: "discussion", alive, ... }` then `comment set ["text"] [["test comment"]]` | the comment, with old-style rich text (not CRDT) |
| `discussion listAfter ["comments"]`, `block listAfter ["discussions"]` | ordered id lists on the parent, like `content` |
| `user_seen_record update { last_seen_at, subscription_state: "subscribed" }` | read state and notification subscription for the author |

Resolving is a single `discussion update { resolved: true }`. The socket then carries `versions/<id>:discussion:<id>`, `versions/<id>:comment:<id>` and `versions/<id>:follow:<id>` notifications.

### Databases

Notion calls a database a `collection`, and each saved view a `collection_view`. Inserting an inline database (`/database inline`) created three records in one transaction:

```text
block           set { type: "collection_view", collection_id, view_ids: [<viewId>], format: { collection_pointer: { table: "collection", id, spaceId } } }
collection      set { id, format: {}, parent_id: <that block>, parent_table: "block", alive: true }
collection_view set { id, type: "table", format: { collection_pointer, table_properties: [{ property: "title", visible, width }], table_wrap: true }, page_sort: [], parent_id: <that block>, parent_table: "block" }
collection      updateCollectionPropertySchema ["schema"] { primitiveOp: { command: "update", args: { "title": { name: "Name", type: "title" } } } }
```

- **Schema** lives on the collection as `schema`, a map from a short random property id (e.g. `HA\=`, 4 characters) to `{ name, type }`. The title column always has the id `title`. Schema changes use `updateCollectionPropertySchema` with a nested `primitiveOp`, so a change to one property doesn't overwrite the rest of the schema.
- **Adding a property** (type Select): `updateCollectionPropertySchema` with `{ "<propId>": { name: "Select", type: "select" } }`, plus `collection_view update ["format"] { table_properties: [...] }` to show the column in this view. Column visibility and width are per view.
- **Adding a row** (`TableGroupResults.handleAddRowClick`): a row is just a `page` block whose parent is the collection: `block setParent { parentId: <collectionId>, parentTable: "collection" }`. Its order in the view is `collection_view listAfter ["page_sort"] { id }`, so manual row order is stored per view. This one request went to `saveTransactionsMain` instead of `saveTransactionsFanout`, together with a `user_settings` update to `lastUsedDatabases`.
- **Setting a select value that doesn't exist yet**: one transaction adds the option to the schema (`updateCollectionPropertySchema ["schema", "<propId>", "options"]` with `primitiveOp: keyedObjectListAfter { value: { id, value: "Hot", color: "default" } }`) and sets the cell (`updateBlockPropertyValue ["properties", "<propId>"]` with `primitiveOp: set [["Hot"]]`). Cell values sit in the row block's `properties` under the property id, in the same rich-text array format as titles.
- **Sorting a view**: `collection_view update ["query2"] { sort: [{ property: "title", direction: "ascending" }] }`. Filters live in the same `query2` object. The `userAction` was `collectionFilterActions.applyTemporaryStateIfPrivate`, which suggests that on shared databases a sort is first kept as a temporary state for that user only (inferred from the name).
- **Querying**: the earlier page load of an existing database called `queryCollection?src=initial_load`. For this new database the client never called it and rendered the rows from records it already had locally.
- The socket subscribed to `collection/<id>` and `versions/<id>:collection` / `versions/<id>:collection_view` alongside the block keys.

### File upload

Uploading an image is three steps:

1. `POST /api/v3/getUploadSpaceFileUrl` with `{ bucket: "secure", name, contentType, contentLength, record: { table: "block", id, spaceId }, supportExtraHeaders: true, spaceId }`. The response contains `url: "attachment:<fileId>:test-image.png"`, a `signedGetUrl` on `file.notion.com/f/f/<spaceId>/<fileId>/<name>` (with an expiry timestamp and signature), and an S3 presigned POST: `signedUploadPostUrl` plus `fields` (key `<spaceId>/<fileId>/<name>`, storage class `INTELLIGENT_TIERING`, tags for the uploader and block).
2. The browser posts the file straight to `prod-files-secure.s3.us-west-2.amazonaws.com` (status 204). Notion's servers never receive the bytes.
3. A transaction on the image block: `update ["format"] { block_width, block_height, block_aspect_ratio, block_preserve_scale, ... }`, then `updateBlockPropertyValue ["properties"] { source: [["attachment:<fileId>:test-image.png"]], size: [["79 B"]] }` and `format.display_source`.

The block stores the stable `attachment:` reference, not a URL; readable URLs are signed on demand (`getSignedFileUrls`, from the first pass).

### Sharing

Opening the Share menu called `getVisibleUsers`, `getSimilarUsers`, `getInternalDomains`, `getInternalPageGuestCount` and `getSubscriptionData`, plus a `syncRecordValuesSpaceInitial` for the page's permissions. The menu offers per-user roles and a "General access" setting with three levels: only invited people, everyone in the workspace, and anyone on the web with the link. Private pages store access in the block's `permissions` array (`user_permission` with a `role`), as seen when the page was created.

I did not change general access: switching the test page to "anyone with the link" was blocked by a permission check in this session, and inviting someone would have emailed them. The operation that changes sharing is therefore not captured.

### What was not covered

- Changing sharing (making a page public or inviting someone): see "Sharing" above.
- Only one user (two tabs). Multi-user permission checks and what a second person's client receives were not observed.
- Database filters, other view types (board, calendar), relations, rollups and formulas.
- The local SQLite cache was seen loading but its tables were not inspected.
- No Notion code was read. All of the above is from traffic on a page created for the test.

### What this means for OpenNotion

| Notion behaviour | Suggestion for phase 2 |
| --- | --- |
| Text in a block is a sequence CRDT with `[clientId, clock]` ids and origins | Yjs `Y.XmlFragment` / `Y.Text` per document is the same model; BlockNote already binds to Yjs |
| Block tree is server-ordered ops, not CRDT | Either keep the tree in Yjs too (simplest with BlockNote, one `Y.Doc` per page) or mirror Notion and keep the tree in Postgres with ops. One Y.Doc per page is the less work path. |
| Writes go over HTTP, socket only invalidates | Hocuspocus sends updates over the socket instead. Persist with Hocuspocus's `onStoreDocument` (debounced) and keep the `blocks` table as a derived read model for search and sharing. |
| Records keep both `properties.title` and `crdt_data` | Keep the plain-text/JSON block content columns next to the Yjs state so search, previews and the share page don't need to load Yjs |
| Presence is block-level, with a server-signed token | Hocuspocus awareness gives cursor-level presence for free; authorize the socket with a short-lived signed token issued by the Next.js app, like `getPresenceAuthorizationToken` |
| Client caches pages locally (WASM SQLite) and queues writes | `y-indexeddb` gives the offline cache and replay; it can come after live editing works |
| Undo is client-side inverse ops, per client | Yjs `UndoManager` with tracked origins does the same (each user undoes only their own changes) |
| Comments anchor to CRDT character ids | Anchor comments with Yjs relative positions (`Y.createRelativePositionFromTypeIndex`) instead of offsets |
| Uploads go browser to S3 with a presigned POST; blocks store `attachment:<id>` | Store a file id on the block and sign read URLs on demand, so links can expire and permissions apply |
| Database schema is a map of short property ids; rows are pages with the collection as parent; order is per view | Fits a `collections` table with a JSON schema keyed by property id, rows as `pages` with `collection_id`, and per-view sort/filter JSON |

## Rerunning the capture

The scripts are in [`docs/capture/`](capture/). Chrome DevTools "Save as HAR" (below) gets the HTTP calls but drops websocket frames from most HAR exports, and the tool used here could only return small snippets, so these send every event to a local folder instead.

```bash
python3 docs/capture/collector.py ./notion-capture   # serves http://127.0.0.1:8765/
```

1. Open `http://127.0.0.1:8765/` in Chrome and press **OPEN**. It opens Notion in a tab that can `postMessage` back to the collector (Notion's content security policy blocks fetches to localhost, but not messages to the window that opened it).
2. In that Notion tab, open the page you want to test, then paste [`hooks.js`](capture/hooks.js) into the DevTools console.
3. Before each action run `mark('what I am about to do')` in the console, then do it. Open the same page in a second tab to watch changes arrive.
4. `python3 docs/capture/timeline.py ./notion-capture events.json` prints a timeline and writes all events to one file.

The capture contains your user id, workspace id and page content (auth cookies and tokens are not recorded), so keep it out of the repo.

## Going further on your own machine

REA runs locally, so these work from your computer where Notion is reachable:

1. **Network capture of the web app (HTTP only).** In Chrome, open DevTools, Network tab, use Notion for a minute (open a page, type, share, move a block), then right-click and "Save all as HAR with content". Then:

   ```bash
   npx -y rea-agents@latest inspect-web-network-capture /abs/path/notion.har har --json > notion-har.json
   ```

   That shows the real `api/v3` calls, including the ones that save edits, which is what phase 2 (live sync) needs to learn from.

2. **The desktop app.** The Notion desktop app is Electron. After installing it, point REA at the app folder (on macOS `/Applications/Notion.app`):

   ```bash
   npx -y rea-agents@latest analyze-javascript-application /Applications/Notion.app --json > notion-desktop.json
   ```

Keep captures private: a HAR file contains your session cookies and page content.
