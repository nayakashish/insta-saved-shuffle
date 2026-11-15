# Architecture

A static site with no build step and no dependencies. ES modules loaded
directly by the browser. Everything under `public/` is the deployable app.

## Module map

```
public/
  index.html            markup for the four views and the settings panel
  styles.css            all styling
  sw.js                 offline cache for the app's own files
  js/
    app.js              entry point: boot, routing, bundled default list
    events.js           tiny publish/subscribe bus
    state.js            the single state object S, load/save, migration
    store.js            IndexedDB key-value wrapper (only state.js uses it)
    library.js          read-only queries: eligibility, counts, scope labels
    topics.js           hashtag extraction and the topic taxonomy   [pure]
    queue.js            shuffle and no-repeat queue maths           [pure]
    rotation.js         what plays next: every action that changes the queue
    player.js           the stage: embeds, preloading, crop, failure detection
    parser.js           export parser (HTML, JSON, ZIP) and merge
    zip.js              minimal ZIP reader
    ui/
      dom.js            element helper, formatting
      home.js           start page
      watch.js          player chrome: labels, buttons, keys, swipes
      settings.js       settings panel
      importer.js       import view
      toast.js          transient messages
test/                   node:test suites for the pure modules
dev-server.mjs          static dev server
```

## Layers

```
            ui/*            (DOM, user input)
              |
   rotation.js   player.js  (behaviour)
        |            |
   library.js  queue.js  topics.js   (pure-ish logic)
        |
     state.js  ->  store.js -> IndexedDB
```

Rules that keep it tidy:

- **`ui/*` never touches the queue directly.** It calls `rotation.js`
  (`go`, `setScope`, `cycleScope`, `setMode`, `toggleFav`, ...).
- **`rotation.js` never touches the DOM.** It mutates `S` and emits
  `rotation`. `player.js` and `ui/watch.js` listen and redraw.
- **`player.js` is the only module that knows about Instagram's embed.**
  The measured geometry and the `MEASURE` message handling live there and
  nowhere else.
- **`topics.js` and `queue.js` are pure** and covered by tests.
- **Only `state.js` persists.** `store.js` is the seam a sync backend would
  wrap (see `EXTENDING.md`).

## Events

| Event | Sent when | Listeners |
|---|---|---|
| `rotation` `{ direction }` | the item on screen or the queue changed | player (show slide, preload), watch (labels) |
| `library` | items, kinds, flags or settings changed | home (repaint), watch |
| `layout` | the crop setting changed | player |
| `erased` | all data was erased | app (re-route) |
| `toast` | a short message for the user | toast |

## State

One object, `S` in `state.js`:

- `items`: `Map<shortcode, item>`. An item is what the export says
  (`code`, `kind`, `user`, `name`, `caption`, `savedAt`, `collections`) plus
  derived `tags` and `topics`, recomputed on every load.
- Flag sets keyed by shortcode: `seen`, `hidden`, `favs`, `broken`.
- `kinds`: which link kinds are included (reels on, posts and IGTV off).
- `scope`: the one thing being watched. `{ type, value }` where type is
  `all`, `topic`, `tag`, `account`, `collection`, `starred` or `broken`.
- `mode`: `shuffle` or `newest`. `queue` and `pos`: the current order.

An item is eligible when it is not hidden, its kind is included, it is not
known-unplayable (unless that skipping is off) and it matches the scope.

## Rotation

- **Shuffle.** `queue.js` keeps everything already seen at the front in
  order and shuffles the unseen behind it, so nothing repeats until the
  whole selection has been shown; then a new cycle starts. Changing scope or
  kinds rebuilds the queue without losing that property.
- **Newest.** The eligible items sorted by saved date, latest first.
- **Scope cycling.** `library.siblings()` returns the ring a scope steps
  through: Everything and the topics for broad scopes, otherwise the other
  tags, accounts or collections.

Rotation is only "active" while the player view is showing. Changes made
elsewhere (start page, settings) are recorded and applied on entry, so
browsing never marks anything as watched.

## Player

- One embed on screen, the next two loading invisibly (`PRELOAD_AHEAD`).
  Pressing Next swaps in an already-loaded iframe.
- Leaving the player removes every iframe, which is also what stops audio.
- **Crop.** The embed is laid out wider than its window and offset so only
  the video shows. Constants at the top of `player.js`.
- **Unplayable detection.** A working embed posts a `MEASURE` message to the
  parent; a removed or private one loads but never does. No message within
  3.5 s of load marks the save as unplayable (`S.broken`). Because the next
  two are preloaded, most are found and dropped from the queue before the
  viewer reaches them. Timeouts and offline do not count.
- **Swipes.** A cross-origin iframe swallows touches, so transparent strips
  over the top and bottom thirds of the video catch swipes; the middle is
  left to Instagram for play and pause.

## Topics

`topics.js` holds a hand-written taxonomy: each topic lists keyword
patterns (`drum` matches as a substring, `=car` exactly). An item's topics
come from its hashtags, minus reach-bait tags (`fyp`, `viral`, ...); with no
usable hashtags, its caption words are tried. Unmatched items land in
"Everything else". It runs locally and instantly; to tune it, edit the
`TOPICS` array and add a test.

## Views and routing

Hash routes, so the browser's back button works and the site stays a plain
static file set: `#/` start page, `#/watch` player, `#/import`, `#/privacy`.
With an empty library every route lands on import.

## Testing

`npm test` runs the pure modules under Node's built-in runner. Browser
behaviour (import of a real export, embeds, preloading, detection, layouts)
was exercised with headless Chrome driven over the DevTools protocol; those
scripts are not part of the repo because they depend on a private export.
