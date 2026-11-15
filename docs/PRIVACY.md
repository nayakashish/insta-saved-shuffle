# Privacy

This is the developer-facing companion to the in-app notes at `#/privacy`.

## Data inventory

| Data | Source | Stored | Leaves the device |
|---|---|---|---|
| Saved-post list: shortcode, kind, account username and display name, caption, saved date, collection names | The user's own Instagram export | IndexedDB `saved-shuffle`, key `items` | No |
| Watched / starred / hidden / unplayable flags, included kinds, scope, settings, queue position, last-import summary | Use of the app | IndexedDB, key `state` | No |
| `embed-signals`, `skip-default` flags | Use of the app | localStorage | No |
| The app's own files | The server | Cache Storage (service worker) | n/a |

Tags and topics are derived from captions in the browser on each load.

There are no cookies, no analytics, no error reporting, no third-party
scripts or fonts, and no accounts.

## Network requests

1. The app's own static files, from wherever it is hosted.
2. `default/saved_posts.html` from the same host, once, on a first visit
   with an empty library (see below).
3. Instagram's embed pages (`instagram.com/reel/<code>/embed/`) in iframes,
   for the reel on screen and the next two. Instagram receives the usual
   request metadata and its own cookies if the visitor is signed in there.
   The app cannot see into those iframes; it only reads the size message
   the embed sends to its parent.

Nothing from an import is ever sent to the host.

## The bundled default list

The dev server exposes `saved/saved_posts.html` at
`/default/saved_posts.html` so the site opens with a list preloaded.

- That file is one person's saved list. **Anyone who can reach the server
  can download it.** Bind the server accordingly: `npm run dev` listens on
  localhost and, if present, the Tailscale address; `npm run dev:local` is
  localhost only; `npm run dev:lan` opens it to the local network.
- Only that single file is served. The rest of `saved/` is not reachable,
  and the folder is git-ignored.
- The service worker never caches it.
- A static deploy of `public/` contains no default list.
- Do not publish the site with a default list unless the list's owner means
  to make it public.

## Erasing

Settings, then "Erase all data", clears the IndexedDB store and resets
in-memory state. It also sets `skip-default` so a bundled list is not
silently reloaded; importing clears that flag.

## If accounts are ever added

The statement "nothing is uploaded" stops being true. See `EXTENDING.md`
for what would have to change, including end-to-end encryption as the way
to keep most of this promise.
