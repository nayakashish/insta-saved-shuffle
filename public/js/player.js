// The stage: one Instagram embed on screen, the next two loading behind it.
//
// Geometry of Instagram's embed page, measured in Nov 2026. For an embed W
// pixels wide: a 54px account strip, a media box, then a 154px footer. Tall
// videos sit in a box capped at 1.25 W, pillarboxed to about 0.706 W wide and
// 1.205 W tall. The embed reports its total height to the parent page in a
// "MEASURE" message, and sends none at all for removed or private posts.
// None of this is a documented contract: if the embed changes, these
// constants are the place to look.

import { S } from './state.js';
import { on } from './events.js';
import { currentCode, upcoming, go, hideCurrent, reportBroken, reportPlayable } from './rotation.js';

const EMBED_HEADER = 54;
const EMBED_FOOTER = 154;
const EMBED_BOX = 1.25;
const EMBED_VIDEO_W = 0.706;
const EMBED_VIDEO_H = 1.205;
const LOAD_TIMEOUT_MS = 12000;
const SIGNAL_WAIT_MS = 3500;
const PRELOAD_AHEAD = 2;
const PRELOAD_SETTLE_MS = 250; // do not load embeds for reels being skipped past
const SEGMENT = { reel: 'reel', post: 'p', tv: 'tv' };

export const permalink = (item) => `https://www.instagram.com/${SEGMENT[item.kind]}/${item.code}/`;
const embedUrl = (item) => `${permalink(item)}embed/`;

let stage = null;
let active = false;
let current = null;
const preloads = new Map(); // code -> slide
let preloadTimer = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Whether Instagram's embed has ever sent us a MEASURE message. Once it has,
// an embed that loads without one is treated as unavailable.
let signalsKnown = false;
try {
  signalsKnown = localStorage.getItem('embed-signals') === '1';
} catch { /* storage unavailable */ }

/* Layout ----------------------------------------------------------------- */

function layoutSlide(slide) {
  const { width, height } = stage.getBoundingClientRect();
  if (!width || !height) return;
  const { clip, iframe } = slide;
  const isVideo = slide.item.kind !== 'post';
  let clipW;
  let clipH;
  let frameW;
  let frameH;
  let left = 0;
  let top = 0;
  if (isVideo && slide.tall && S.settings.crop) {
    // Fill: show only the video, cropping Instagram's strip, bars and footer.
    const ratio = EMBED_VIDEO_H / EMBED_VIDEO_W;
    clipW = Math.floor(Math.min(width, height / ratio));
    clipH = Math.floor(clipW * ratio);
    frameW = Math.round(clipW / EMBED_VIDEO_W);
    frameH = EMBED_HEADER + Math.ceil(frameW * EMBED_BOX) + EMBED_FOOTER + 200;
    left = -Math.round((frameW - clipW) / 2);
    top = -Math.round(EMBED_HEADER + (frameW * (EMBED_BOX - EMBED_VIDEO_H)) / 2);
  } else if (isVideo) {
    // Fit: Instagram's strip and the whole media box, footer cropped.
    const box = slide.tall ? EMBED_BOX : Math.max(0.5, slide.boxRatio || 1);
    clipW = Math.floor(Math.max(240, Math.min(width, 640, (height - EMBED_HEADER) / box)));
    clipH = Math.min(height, Math.round(EMBED_HEADER + clipW * box));
    frameW = clipW;
    frameH = clipH + EMBED_FOOTER + 200;
  } else {
    // Posts: the whole embed, scrollable, since photos and carousels vary.
    clipW = Math.floor(Math.min(width, 520));
    clipH = Math.floor(slide.measured ? Math.min(height, slide.measured) : height);
    frameW = clipW;
    frameH = clipH;
  }
  clip.style.width = `${clipW}px`;
  clip.style.height = `${clipH}px`;
  iframe.style.width = `${frameW}px`;
  iframe.style.height = `${frameH}px`;
  iframe.style.left = `${left}px`;
  iframe.style.top = `${top}px`;
}

export function layoutStage() {
  if (!active) return;
  if (current) layoutSlide(current);
  for (const slide of preloads.values()) layoutSlide(slide);
}

/* Loading and failure ---------------------------------------------------- */

function failSlide(slide, reason, unavailable = false) {
  if (slide.state === 'failed') return;
  clearTimeout(slide.timer);
  slide.state = 'failed';
  slide.el.classList.remove('is-loading', 'is-loaded');
  slide.el.classList.add('is-failed');
  slide.label.textContent = reason;
  // Only "Instagram answered, but with no post" counts as unplayable. A
  // timeout or being offline says nothing about the post itself.
  if (unavailable) reportBroken(slide.code);
}

function markLoaded(slide) {
  clearTimeout(slide.timer);
  slide.state = 'loaded';
  slide.el.classList.remove('is-loading', 'is-failed');
  slide.el.classList.add('is-loaded');
}

function loadSlide(slide) {
  clearTimeout(slide.timer);
  slide.state = 'loading';
  slide.el.classList.remove('is-failed', 'is-loaded');
  slide.el.classList.add('is-loading');
  slide.label.textContent = 'Loading from Instagram';
  if (!navigator.onLine) {
    failSlide(slide, 'You are offline');
    return;
  }
  slide.iframe.src = embedUrl(slide.item);
  slide.timer = setTimeout(() => failSlide(slide, 'Did not load'), LOAD_TIMEOUT_MS);
}

// The embed page finished loading. Removed and private posts load fine too
// (as an Instagram error page), so wait for the MEASURE signal when we know
// this browser receives them.
function onFrameLoad(slide) {
  if (slide.state !== 'loading') return;
  clearTimeout(slide.timer);
  if (!signalsKnown) {
    slide.tall = false;
    layoutSlide(slide);
    markLoaded(slide);
    return;
  }
  slide.timer = setTimeout(() => failSlide(slide, 'Not available', true), SIGNAL_WAIT_MS);
}

function onEmbedMessage(event) {
  if (!/^https:\/\/(www\.)?instagram\.com$/.test(event.origin)) return;
  const slide = [current, ...preloads.values()].find((s) => s && s.iframe.contentWindow === event.source);
  if (!slide) return;
  let data = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return;
    }
  }
  const measured = data && data.type === 'MEASURE' && data.details && Number(data.details.height);
  if (!measured) return;
  if (!signalsKnown) {
    signalsKnown = true;
    try {
      localStorage.setItem('embed-signals', '1');
    } catch { /* storage unavailable */ }
  }
  const frameW = slide.iframe.getBoundingClientRect().width || 1;
  slide.measured = measured;
  slide.boxRatio = (measured - EMBED_HEADER - EMBED_FOOTER) / frameW;
  const tall = slide.boxRatio > EMBED_BOX - 0.06;
  if (tall !== slide.tall || slide.item.kind === 'post') {
    slide.tall = tall;
    layoutSlide(slide);
  }
  reportPlayable(slide.code);
  if (slide.state === 'loading' || slide.state === 'failed') markLoaded(slide);
}

/* Slides ----------------------------------------------------------------- */

function button(className, text, onClick) {
  const el = document.createElement('button');
  el.className = className;
  el.type = 'button';
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

function makeSlide(code) {
  const item = S.items.get(code);
  const el = document.createElement('div');
  el.className = `slide kind-${item.kind}`;
  const clip = document.createElement('div');
  clip.className = 'clip';

  const iframe = document.createElement('iframe');
  iframe.title = item.user ? `Instagram post by ${item.user}` : 'Instagram post';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen; web-share; clipboard-write';
  if (item.kind !== 'post') iframe.scrolling = 'no';

  const veil = document.createElement('div');
  veil.className = 'veil';
  const label = document.createElement('div');
  label.className = 'veil-label';
  const text = document.createElement('p');
  text.className = 'veil-text';
  text.textContent = 'Instagram will not play this one outside its own app. It may be private, removed or restricted from embedding.';
  const actions = document.createElement('div');
  actions.className = 'veil-actions';
  const open = document.createElement('a');
  open.className = 'btn btn-solid';
  open.href = permalink(item);
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Open on Instagram';

  const slide = { code, item, el, clip, iframe, label, state: 'idle', timer: null, tall: item.kind !== 'post', boxRatio: 0, measured: 0 };
  actions.append(
    open,
    button('btn', 'Skip', () => go(1)),
    button('btn', 'Hide for good', hideCurrent),
    button('btn', 'Try again', () => loadSlide(slide)),
  );
  veil.append(label, text, actions);

  // Transparent strips over the top and bottom thirds of a video: the
  // iframe would swallow touches, these let a swipe there change reel. The
  // middle stays Instagram's, so a tap there plays or pauses.
  const pads = [];
  if (item.kind !== 'post') {
    for (const edge of ['top', 'bottom']) {
      const pad = document.createElement('div');
      pad.className = `pad pad-${edge}`;
      pad.addEventListener('click', () => {
        el.classList.add('is-through');
        setTimeout(() => el.classList.remove('is-through'), 4000);
      });
      pads.push(pad);
    }
  }
  clip.append(iframe, ...pads, veil);
  el.append(clip);
  iframe.addEventListener('load', () => onFrameLoad(slide));
  return slide;
}

function disposeSlide(slide) {
  if (!slide) return;
  clearTimeout(slide.timer);
  slide.el.remove();
}

function mount(slide, preloading) {
  slide.el.classList.toggle('is-preload', preloading);
  stage.append(slide.el);
  layoutSlide(slide);
  loadSlide(slide);
}

// Keep embeds for the next reels loading in the background so "next" shows
// a ready player instead of a spinner.
function syncPreloads() {
  clearTimeout(preloadTimer);
  const connection = navigator.connection;
  const wanted = connection && connection.saveData ? [] : upcoming(PRELOAD_AHEAD);
  for (const [code, slide] of preloads) {
    if (!wanted.includes(code)) {
      disposeSlide(slide);
      preloads.delete(code);
    }
  }
  if (wanted.every((code) => preloads.has(code))) return;
  preloadTimer = setTimeout(() => {
    if (!active) return;
    for (const code of upcoming(PRELOAD_AHEAD)) {
      if (preloads.has(code) || (current && current.code === code)) continue;
      const slide = makeSlide(code);
      preloads.set(code, slide);
      mount(slide, true);
    }
  }, PRELOAD_SETTLE_MS);
}

function showSlide(code, direction) {
  let slide = preloads.get(code);
  if (slide) {
    preloads.delete(code);
    slide.el.classList.remove('is-preload');
  } else {
    slide = makeSlide(code);
    mount(slide, false);
  }
  const old = current;
  current = slide;
  if (old && !reducedMotion.matches && slide.el.animate) {
    const timing = { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
    const from = direction >= 0 ? '100%' : '-100%';
    const to = direction >= 0 ? '-100%' : '100%';
    slide.el.animate([{ transform: `translateY(${from})` }, { transform: 'none' }], timing);
    const leaving = old.el.animate([{ transform: 'none' }, { transform: `translateY(${to})` }], timing);
    const done = () => disposeSlide(old);
    leaving.finished.then(done, done);
  } else {
    disposeSlide(old);
  }
}

function disposeAll() {
  clearTimeout(preloadTimer);
  disposeSlide(current);
  current = null;
  for (const slide of preloads.values()) disposeSlide(slide);
  preloads.clear();
}

function onRotation({ direction }) {
  if (!active) return;
  const code = currentCode();
  if (!code) {
    disposeAll();
    return;
  }
  if (!current || current.code !== code) showSlide(code, direction);
  syncPreloads();
}

/* Public ----------------------------------------------------------------- */

export function initPlayer(stageEl) {
  stage = stageEl;
  window.addEventListener('message', onEmbedMessage);
  new ResizeObserver(layoutStage).observe(stage);
  window.addEventListener('online', () => {
    if (current && current.state === 'failed') loadSlide(current);
  });
  on('rotation', onRotation);
}

// Leaving the player removes every embed, which is also what stops playback.
export function setPlayerActive(value) {
  active = value;
  if (!active) disposeAll();
}
