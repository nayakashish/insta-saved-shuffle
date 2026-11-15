# Extending Saved Shuffle: accounts and other people's data

Status: notes for later. Nothing here is built.

## Where things stand

The app is a static site. Each browser holds one library in IndexedDB under
two keys (`public/js/store.js`):

- `items`: the imported saves, `{ code, kind, user, name, caption, savedAt,
  collections[] }`, keyed by Instagram shortcode.
- `state`: watched / hidden / starred sets, filters, settings, the current
  queue and position, last import summary.

So "other people using it" already works today in the simplest sense: anyone
can open the site and import their own export, and their data stays in their
own browser. Accounts are only needed for things that one browser cannot do.

## What accounts would actually buy

1. The same library on phone and laptop (sync).
2. Not losing everything when browser storage is cleared.
3. Several people sharing one device without mixing libraries.
4. Later, optional sharing (a collection, a "watch together" list).

Number 3 does not need a server at all, and 2 barely does. Worth doing those
first.

## Suggested order

### Step 1. Backup file (no server, about a day)

"Export my library" writes one JSON file with `items` and `state`;
"Restore" reads it back through the same merge path the importer uses.
Solves storage loss and manual device-to-device transfer. No privacy
change.

### Step 2. Local profiles (no server, a day or two)

Namespace the storage keys by profile id (`items:<id>`, `state:<id>`) and add
a profile switcher. `store.js` is the only module that touches storage, so
the change is contained there plus a small picker in the Library panel.
Existing data migrates into a default profile.

### Step 3. Accounts and sync (needs a backend)

This is the real step change: the project stops being "fully client-side",
and the privacy statement in the UI has to change with it.

**Sign-in.** Passkeys or emailed magic links. Never Instagram credentials
and no "Log in with Instagram": the Instagram API does not expose saved
posts, so it would add risk and review overhead for no benefit. Each person
still uploads their own export.

**Server data model.**

```
users        id, email (or passkey handle), created_at
items        user_id, code, kind, username, caption, saved_at, collections
             primary key (user_id, code)
flags        user_id, code, seen_at, hidden_at, starred_at, updated_at
             primary key (user_id, code)
settings     user_id, json, updated_at
```

Keep the queue and position local to each device; only sync facts (items and
flags). Two devices do not need the same shuffle order, and syncing it
invites conflicts.

**Sync protocol.** Small and boring:

- `POST /items` bulk upsert after an import (the client already produces the
  merged list).
- `GET /changes?since=<cursor>` and `POST /changes` for flags, with
  last-write-wins per (item, flag) using `updated_at`. Hiding and starring
  are idempotent, so conflicts are harmless.
- The client keeps working offline against IndexedDB and syncs when online.
  `store.js` gains a sync wrapper; the rest of the app does not change.

**Parsing stays in the browser.** The server should receive the extracted
list, not the raw export, so uploads are small and the full export (which
can include far more than saves) never leaves the device.

**Hosting.** Any small API plus a relational store fits. A serverless
function with a SQLite-style database is enough for this shape and volume
(a library is a few thousand rows, about 2 MB with captions).

### Step 4 (optional). End-to-end encrypted sync

Encrypt items and flags in the browser with a key derived from a passphrase
and store only ciphertext. The server then cannot read anyone's saves, and
the "your data is private" promise mostly survives. Cost: no server-side
features (search, sharing) and a real "lost passphrase means lost data"
problem. Decide this before step 3 ships, because retrofitting it changes
the schema.

## Things to decide before step 3

- **Privacy promise.** Today the UI says nothing is uploaded. With accounts
  that becomes "your list is stored on our server" unless step 4 is done.
  A saved list is personal (it shows what someone found worth keeping), so
  treat it as sensitive: minimal logs, delete-my-account that really
  deletes, a short written privacy policy, and data export.
- **Third-party data.** Captions and usernames belong to other people's
  posts. Storing shortcodes only (and dropping captions server-side) reduces
  what is held; the client can keep captions locally.
- **Instagram's terms.** The current design is deliberately on the safe
  side: user-supplied official export, public embed player, no API, no
  scraping, no automation of the user's account. A hosted multi-user version
  should keep exactly that line. In particular do not fetch saves on a
  user's behalf, do not proxy or download video, and do not strip the embed
  further than cropping. Re-read Meta's embed and platform terms before
  going public; a hosted product gets more scrutiny than a personal page.
- **Embeds remain the weak point.** Playback depends on Instagram's embed
  page continuing to work in an iframe. The crop geometry and the
  unavailable-post signal are both measured, not contractual. More users
  means more people affected when that layout changes, so keep the
  uncropped fallback one switch away.
- **Abuse and cost.** Uploads are user-controlled JSON: validate shortcodes
  against the existing regex, cap library size, rate-limit.

## What is already shaped for this

- Items are keyed by shortcode and merges are idempotent, so re-imports and
  multi-device upserts are the same operation.
- All persistence goes through `store.js` (`get`, `set`, `clearAll`).
- Rotation logic in `queue.js` is pure and takes the eligible set and the
  seen set as inputs, so it does not care where they came from.
- Flags are plain sets of shortcodes; they need per-entry timestamps before
  they can sync (a small local migration).
