# Saved Shuffle

A web app that plays your own Instagram saved reels shuffled, newest first,
or by topic. It reads the official "Download your information" export, runs
entirely in the browser, and plays videos through Instagram's public embed
player.

No backend, no login, no Instagram API, no scraping.

## Run it

```
npm run dev         # http://localhost:4321/  and, if Tailscale is up, http://<tailscale-ip>:4321/
npm run dev:local   # this machine only
npm run dev:lan     # every interface, including the local network
npm test            # pure-logic tests
```

There is nothing to build and no dependencies. `public/` is the whole site;
deploy that folder to any static host.

**Default list.** If `saved/saved_posts.html` exists, the dev server exposes
that one file at `/default/saved_posts.html` and the site loads it on a first
visit, so it opens with a library already in place. Anyone who can reach the
server can read that list (see `docs/PRIVACY.md`). A visitor who imports
their own export replaces it in their browser only. `saved/` is git-ignored
and nothing else in it is served.

## Using it

- **Start page.** Counts, Continue / Shuffle everything / Newest first, then
  every way to narrow down: topics, collections, starred, accounts, tags.
- **Player.** One reel at a time. A large Next button, Prev, Star, Hide,
  Open on Instagram, Mix (reshuffle what is left). On a wide screen the
  video sits left with the caption, tags and controls in a panel on the
  right; on a phone or an upright tablet they stack.
- **Topics.** Saves are sorted into topics on the device from their hashtags
  and captions. The bar above the video steps to the previous or next topic
  (also `[` and `]`, or a sideways swipe on the bar). Tap any tag chip to
  watch just that tag; tap the account name for just that account.
- **Shuffle** shows everything in the current selection once before
  anything repeats. **Newest** runs from your latest save backwards.
- **Skipping what will not play.** Saves that only work inside Instagram
  (private, removed, embed-restricted) are detected as they come up and left
  out afterwards. They are listed under "Will not play here" on the start
  page, each with an Open on Instagram link.

Keys: Down / J / Space next, Up / K previous, `[` `]` topic, F star, H hide,
O open, R mix.

## Importing your saves

1. Instagram: Settings, Accounts Center, Your information and permissions,
   Download your information.
2. Some of your information, tick **Saved**, Download to device, format
   **HTML**, date range **All time**.
3. Drop the ZIP on the page, or pick `saved_posts.html` and
   `saved_collections.html` from `your_instagram_activity/saved/`.

**Updating later:** request a new export and import it again. New saves are
added; watched, hidden and starred state is kept, because items are keyed by
Instagram shortcode.

## Docs

- `docs/ARCHITECTURE.md`: modules, state, how rotation, the player and
  topics work.
- `docs/PRIVACY.md`: what is stored, what leaves the device, the default
  list.
- `docs/EXTENDING.md`: adding accounts and sync later.
- `brief.md`: the original brief.

## Test results with a real export (Nov 2026)

| | |
|---|---|
| Links found | 2,390 (2,154 in saved_posts.html, 236 in saved_collections.html) |
| Unique items | 2,179 |
| Duplicates | 211 |
| Reels / posts / IGTV | 1,745 / 429 / 5 |
| Collections | 7 |
| Topics | 17 topics cover about two thirds of saves; the rest have no recognisable subject |

Counts were cross-checked against an independent regex pass over the files.
Verified in headless Chrome with emulated touch at phone and iPad sizes:
import, both orders, topic and tag scopes, preloading (the next reel is
already loaded when Next is pressed), detection of nonexistent posts, erase.
Not verified on a physical iPad or in Safari.

## Limitations

- **No autoplay.** Instagram's embed does not autoplay and accepts no
  autoplay parameter (several were tried); a page cannot start playback
  inside it. Each reel needs one tap on the video. There is no auto-advance
  either, because the embed exposes no playback events.
- **Swiping over the video uses overlay strips.** A cross-origin iframe
  swallows touches, so transparent strips over the top and bottom thirds of
  the video catch swipes. The middle third is Instagram's: tap there to play
  or pause. A tap on a strip lets the next tap through for four seconds, for
  controls Instagram puts near the edges. After clicking into the video the
  keyboard belongs to the embed until you click outside it.
- **Cropping is measured, not an API.** "Fill the frame" crops Instagram's
  header, footer and side bars using geometry measured from the embed page
  (constants at the top of `js/player.js`). A thin dark margin can remain
  depending on a video's aspect ratio. If Instagram changes the embed,
  switch the option off in Settings or adjust the constants. Non-vertical
  videos fall back to the uncropped embed automatically.
- **Unplayable detection has gaps.** It relies on the embed's `MEASURE`
  message, so it catches posts that are gone or private. A reel that loads
  but shows Instagram's own "watch on Instagram" prompt inside the player
  looks the same as a working one from outside and is not detected. There
  is no way to check the whole library up front without loading every
  embed, so saves are checked as they approach in the queue.
- **Preloading costs data.** The next two embeds load in the background.
  It is skipped when the browser reports data-saver mode.
- **Topics are keyword matching.** They are a convenience, not a
  classifier: some saves land in the wrong topic and about a third in none.
- **Saved dates are parsed as local time**; the export does not say which
  time zone it used. Items that only appear in collections have no saved
  date and sort last in Newest.
- **Instagram can see which embeds the browser loads**, as with any embedded
  reel. Nothing else leaves the device.
- The JSON export format is supported on a best-effort basis; only the HTML
  format was tested against real data.
