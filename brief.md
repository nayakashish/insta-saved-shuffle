PROJECT BRIEF: Shuffled Saved Reels Viewer

GOAL
Build a single-page web app that gives a user a shuffled, continuous
viewing experience of their own Instagram saved reels.

WHY THIS APPROACH
Instagram's official APIs (Graph API / Instagram Login API) do not expose a
user's saved posts. Scraping or the private API violates Instagram's terms
and risks account bans, so do NOT use either. Instead, the user requests
"Download Your Information" from Instagram and gives the app the export.
Playback uses Instagram's public embed player.

INPUT
The user has the export as an HTML file (Instagram's HTML export format,
likely saved_posts.html, possibly several files, or a ZIP of the export).
I do not know its exact structure. FIRST STEP: inspect the actual file the
user supplies and adapt the parser to it. Do not assume a structure.

Expected content: entries containing links to instagram.com/reel/<code>/,
instagram.com/p/<code>/ and maybe instagram.com/tv/<code>/, often with a
saved-by username and a timestamp.

CORE FEATURES (MVP)
1. Import: file picker / drag-and-drop for the HTML file(s) (optionally a
   ZIP). Parse in the browser with DOMParser. Extract all links matching
   /instagram\.com\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/. De-duplicate by
   shortcode. Keep username and saved date if present.
2. Filtering: reels only by default (/reel/ links), with a toggle to
   include /p/ posts, since some are not videos.
3. Shuffle: Fisher-Yates shuffle of the list. No repeats until the whole
   list has been seen, then reshuffle. A "reshuffle" button.
4. Player: full-screen, vertical, phone-style feed. One reel at a time in an
   iframe: https://www.instagram.com/reel/<code>/embed
   Navigate with swipe up/down, arrow keys, and on-screen next/prev
   buttons. Preload the next one if it is cheap to do.
5. Fallback: embeds fail or are blocked for some items (private,
   deleted, restricted). Detect load failure or timeout, show a small
   "Open on Instagram" link, and offer to skip. Do not crash the feed.
6. Persistence: store the imported list and the seen/unseen state in
   localStorage or IndexedDB so the user does not have to re-import each
   visit. Add a "clear data" button.
7. Counter: show "N of M" and a progress indicator.

NICE TO HAVE
- Remove from rotation ("hide this one") and a favorites mark, stored locally.
- Filter by the account that posted it (when username is available).
- Re-import merges new items without losing seen state.
- Dark UI, mobile-first, installable as a PWA.

CONSTRAINTS
- Fully client-side. No backend, no logins, no passwords or tokens.
  The user's data never leaves their browser. State this in the UI.
- No Instagram API keys or scraping. Embed iframes only.
- Plain HTML/CSS/JS is fine (single file preferred), or React + Vite if
  the builder prefers. Keep it simple and deployable as a static site.
- No emojis in the UI or code.

TESTING
- Test with the user's real export file. Report how many links were
  found, how many were reels, and how many were duplicates.
- Verify that embeds actually play in a normal browser. If many fail to
  load, tell the user and propose the "open on Instagram" fallback as the
  primary path.

DELIVERABLE
A working static web app (ideally published as a hosted page or provided as
a single index.html), plus a short note on how to import the export and
any limitations found (for example, embeds that do not autoplay or have
sound off by default).