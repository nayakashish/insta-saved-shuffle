# Saved Shuffle

A single-page web app that plays your own Instagram saved reels in shuffled
order, or newest first. It reads the official "Download your information"
export, runs entirely in the browser, and plays videos through Instagram's
public embed player.

No backend, no login, no Instagram API, no scraping.

## Run it

```
npm run dev        # http://localhost:4321/
npm run dev:ts     # localhost plus this machine's Tailscale address
npm run dev:lan    # every interface, including the local network
npm test           # shuffle / rotation logic
```

There is nothing to build and no dependencies. `public/` is the whole site;
deploy that folder to any static host.

**Default list.** If `saved/saved_posts.html` exists, the dev server exposes
that one file at `/default/saved_posts.html` and the site loads it on a first
visit, so it opens straight into the player with no import step. Anyone who
can reach the server can read that list. A visitor who imports their own
export replaces it in their browser. Nothing else in `saved/` is served, the
folder stays git-ignored, and a static deploy of `public/` has no default
list and starts on the import screen.

## Importing your saves

1. Instagram: Settings, Accounts Center, Your information and permissions,
   Download your information.
2. Some of your information, tick **Saved**, Download to device, format
   **HTML**, date range **All time**.
3. Drop the ZIP on the page, or pick `saved_posts.html` and
   `saved_collections.html` from `your_instagram_activity/saved/`.

**Updating later:** request a new export and import it again (Library, then
"Import a newer export"). New saves are added. Watched, hidden and starred
state is kept, because items are keyed by Instagram shortcode.

## What it does

- Shuffle: Fisher-Yates, no repeats until everything in the current selection
  has been shown, then a fresh order. "Mix" reshuffles only what is left.
- Newest: walks from your latest save back to your first.
- Reels only by default; posts and IGTV are toggles. Filter by account,
  by collection, or starred only.
- Star, hide from rotation, open on Instagram.
- Swipe, arrow keys / J K, wheel, on-screen buttons.
- Removed or private posts are detected and get an "Open on Instagram" /
  skip panel instead of a blank frame.
- Installable (PWA), works offline for the shell.

## Layout

```
public/
  index.html, styles.css
  js/app.js      UI, player, library panel
  js/parser.js   export parser (HTML, JSON, ZIP) and merge
  js/queue.js    shuffle and rotation logic (pure, tested)
  js/store.js    IndexedDB persistence
  js/zip.js      minimal ZIP reader
  sw.js, manifest.webmanifest, icons/
dev-server.mjs   static dev server
test/            node:test suite
docs/EXTENDING.md  notes on adding accounts and sync later
```

## Test results with a real export (Nov 2026)

| | |
|---|---|
| Links found | 2,390 (2,154 in saved_posts.html, 236 in saved_collections.html) |
| Unique items | 2,179 |
| Duplicates | 211 |
| Reels / posts / IGTV | 1,745 / 429 / 5 |
| Collections | 7 |

Counts were cross-checked against an independent regex pass over the files.
Embeds were verified in Chrome: every real reel tried loaded and played
inline; a nonexistent shortcode was correctly flagged as unavailable.

## Limitations found

- **One tap to play.** Instagram's embed does not autoplay; each reel starts
  on the first tap or click. Sound follows the embed's own control. There is
  no way to autoplay or auto-advance, because the embed exposes no playback
  events to the host page.
- **Swiping over the video uses overlay strips.** A cross-origin iframe
  swallows touches, so transparent strips cover the top and bottom thirds of
  the video to catch swipes. The middle third is Instagram's: tap there to
  play or pause. A tap on a strip lets the next tap through for four seconds,
  for controls Instagram puts near the edges. After clicking into the video
  the keyboard belongs to the embed until you click outside it.
- **Cropping is based on measurement, not an API.** "Fill the frame" crops
  Instagram's header, footer and side bars using geometry measured from the
  embed page (constants at the top of `js/app.js`). Depending on a video's
  exact aspect ratio a thin dark margin can remain. If Instagram changes the
  embed layout, switch the option off in the Library panel or adjust the
  constants. Non-vertical videos automatically fall back to the uncropped
  embed.
- **Unavailable-post detection relies on the embed's `MEASURE` message.**
  Until the browser has received one, a removed post shows Instagram's own
  "may be broken" page instead of the fallback panel.
- **Saved dates are parsed as local time**; the export does not say which
  time zone it used. Items that only appear in collections have no saved
  date and sort last in Newest.
- **Posts are not always videos.** That is why they are off by default.
- **Instagram can see which embeds the browser loads**, as with any embedded
  reel. Nothing else leaves the device.
- The JSON export format is supported on a best-effort basis; only the HTML
  format was tested against real data.
