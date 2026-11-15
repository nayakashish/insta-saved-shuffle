import { parseFiles, parseText, mergeEntries } from './parser.js';
import * as store from './store.js';
import { newCycle, rebuildQueue, reshuffleRemaining } from './queue.js';

const $ = (id) => document.getElementById(id);
const SEGMENT = { reel: 'reel', post: 'p', tv: 'tv' };
// Geometry of Instagram's embed page, measured in Nov 2026. For an embed W
// pixels wide: a 54px account strip, a media box, then a 154px footer. Tall
// videos sit in a box capped at 1.25 W, pillarboxed to about 0.706 W wide and
// 1.205 W tall. The embed reports its total height to the parent page in a
// "MEASURE" message, and sends none at all for removed or private posts.
const EMBED_HEADER = 54;
const EMBED_FOOTER = 154;
const EMBED_BOX = 1.25;
const EMBED_VIDEO_W = 0.706;
const EMBED_VIDEO_H = 1.205;
const LOAD_TIMEOUT_MS = 12000;
const SIGNAL_WAIT_MS = 3500;
const DEFAULT_SETTINGS = { crop: true };
const PRELOAD_DELAY_MS = 1500;
const DEFAULT_FILTERS = { reel: true, post: false, tv: false, favOnly: false, account: null, collection: null };

const S = {
  items: new Map(), // code -> { code, kind, user, name, caption, savedAt, collections }
  seen: new Set(),
  hidden: new Set(),
  favs: new Set(),
  filters: { ...DEFAULT_FILTERS },
  settings: { ...DEFAULT_SETTINGS },
  mode: 'shuffle', // 'shuffle' | 'newest'
  queue: [],
  pos: 0,
  shuffleStash: null, // shuffle queue kept while browsing newest-first
  newestCode: null, // where newest-first browsing left off
  lastImport: null,
  isDefault: false, // library is the list bundled with this copy of the site
};

const permalink = (item) => `https://www.instagram.com/${SEGMENT[item.kind]}/${item.code}/`;
const embedUrl = (item) => `${permalink(item)}embed/`;

/* Persistence ------------------------------------------------------------ */

let saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = null;
  return store.set('state', {
    seen: [...S.seen],
    hidden: [...S.hidden],
    favs: [...S.favs],
    filters: S.filters,
    settings: S.settings,
    mode: S.mode,
    queue: S.queue,
    pos: S.pos,
    shuffleStash: S.shuffleStash,
    newestCode: S.newestCode,
    lastImport: S.lastImport,
    isDefault: S.isDefault,
  });
}

function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(saveState, 400);
}

async function loadAll() {
  const [items, state] = await Promise.all([store.get('items'), store.get('state')]);
  if (Array.isArray(items)) for (const item of items) S.items.set(item.code, item);
  if (state) {
    S.seen = new Set(state.seen || []);
    S.hidden = new Set(state.hidden || []);
    S.favs = new Set(state.favs || []);
    S.filters = { ...DEFAULT_FILTERS, ...(state.filters || {}) };
    S.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    S.mode = state.mode === 'newest' ? 'newest' : 'shuffle';
    S.queue = (state.queue || []).filter((code) => S.items.has(code));
    S.pos = Math.min(state.pos || 0, Math.max(0, S.queue.length - 1));
    if ((state.queue || [])[state.pos] !== S.queue[S.pos]) S.pos = Math.max(0, S.queue.indexOf((state.queue || [])[state.pos]));
    S.shuffleStash = state.shuffleStash || null;
    S.newestCode = state.newestCode || null;
    S.lastImport = state.lastImport || null;
    S.isDefault = Boolean(state.isDefault);
  }
}

/* Rotation --------------------------------------------------------------- */

function isEligible(item) {
  const f = S.filters;
  if (S.hidden.has(item.code)) return false;
  if (!f[item.kind]) return false;
  if (f.favOnly && !S.favs.has(item.code)) return false;
  if (f.account && item.user !== f.account) return false;
  if (f.collection && !item.collections.includes(f.collection)) return false;
  return true;
}

function eligibleCodes() {
  const out = [];
  for (const item of S.items.values()) if (isEligible(item)) out.push(item.code);
  return out;
}

function newestFirst(codes) {
  // Stable sort: items without a saved date keep import order, at the end.
  return codes.slice().sort((a, b) => (S.items.get(b).savedAt || 0) - (S.items.get(a).savedAt || 0));
}

function startNewCycle(eligible, justShown) {
  for (const code of eligible) S.seen.delete(code);
  const next = newCycle(eligible, justShown);
  S.queue = next.queue;
  S.pos = next.pos;
}

// Recompute the queue after anything that changes what is eligible.
function refreshQueue() {
  const eligible = eligibleCodes();
  const current = S.queue[S.pos];
  if (S.mode === 'newest') {
    const sorted = newestFirst(eligible);
    let pos = sorted.indexOf(current);
    if (pos < 0 && S.newestCode) pos = sorted.indexOf(S.newestCode);
    if (pos < 0) pos = Math.min(S.pos, Math.max(0, sorted.length - 1));
    S.queue = sorted;
    S.pos = pos;
  } else {
    const next = rebuildQueue({ queue: S.queue, pos: S.pos }, eligible, S.seen);
    if (next.exhausted) {
      startNewCycle(eligible, current);
      toast(`You have been through all ${eligible.length}. Starting a fresh round.`);
    } else {
      S.queue = next.queue;
      S.pos = next.pos;
    }
  }
  present(1);
}

function go(direction) {
  closeCaption();
  const total = S.queue.length;
  if (total === 0) return;
  if (direction > 0) {
    if (S.pos < total - 1) {
      S.pos += 1;
    } else if (S.mode === 'newest') {
      toast('That is your oldest save.');
      return;
    } else if (total === 1) {
      toast('Only one item matches right now.');
      return;
    } else {
      startNewCycle(S.queue.slice(), S.queue[S.pos]);
      toast(`You have been through all ${total}. Reshuffled for a fresh round.`);
    }
  } else if (S.pos > 0) {
    S.pos -= 1;
  } else {
    toast(S.mode === 'newest' ? 'That is your latest save.' : 'This is where the round started.');
    return;
  }
  present(direction);
}

function setMode(mode) {
  if (mode === S.mode) return;
  closeCaption();
  if (mode === 'newest') {
    S.shuffleStash = { queue: S.queue, pos: S.pos };
    S.queue = [];
    S.pos = 0;
  } else {
    const stash = S.shuffleStash || { queue: [], pos: 0 };
    S.queue = stash.queue.filter((code) => S.items.has(code));
    S.pos = Math.max(0, Math.min(stash.pos, S.queue.length - 1));
    S.shuffleStash = null;
  }
  S.mode = mode;
  refreshQueue();
}

function reshuffle() {
  if (S.mode !== 'shuffle') {
    toast('Reshuffle applies to Shuffle order.');
    return;
  }
  const left = S.queue.length - S.pos - 1;
  if (left < 2) {
    toast('Nothing left to reshuffle in this round.');
    return;
  }
  const next = reshuffleRemaining({ queue: S.queue, pos: S.pos });
  S.queue = next.queue;
  disposePreload();
  schedulePreload();
  saveSoon();
  toast(`Reshuffled the ${left} you have not seen yet.`);
}

/* Stage and slides ------------------------------------------------------- */

const stage = $('stage');
let currentSlide = null;
let preloadSlide = null;
let preloadTimer = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Whether Instagram's embed has ever sent us a MEASURE message. Once it has,
// an embed that loads without one is treated as unavailable.
let signalsKnown = false;
try {
  signalsKnown = localStorage.getItem('embed-signals') === '1';
} catch { /* storage unavailable */ }

// Size and position one slide's iframe inside its clip window.
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
    clipW = Math.floor(Math.max(240, Math.min(width, 540, (height - EMBED_HEADER) / box)));
    clipH = Math.min(height, Math.round(EMBED_HEADER + clipW * box));
    frameW = clipW;
    frameH = clipH + EMBED_FOOTER + 200;
  } else {
    // Posts: the whole embed, scrollable, since photos and carousels vary.
    clipW = Math.floor(Math.min(width, 480));
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

function layoutStage() {
  if (currentSlide) layoutSlide(currentSlide);
  if (preloadSlide) layoutSlide(preloadSlide);
}

function failSlide(slide, reason) {
  if (slide.state === 'failed') return;
  clearTimeout(slide.timer);
  slide.state = 'failed';
  slide.el.classList.remove('is-loading', 'is-loaded');
  slide.el.classList.add('is-failed');
  slide.label.textContent = reason;
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
  slide.timer = setTimeout(() => failSlide(slide, 'Not available'), SIGNAL_WAIT_MS);
}

function onEmbedMessage(event) {
  if (!/^https:\/\/(www\.)?instagram\.com$/.test(event.origin)) return;
  const slide = [currentSlide, preloadSlide].find((s) => s && s.iframe.contentWindow === event.source);
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
  if (slide.state === 'loading' || slide.state === 'failed') markLoaded(slide);
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
  text.textContent = 'This one would not load here. It may be private, deleted or restricted from embedding.';
  const actions = document.createElement('div');
  actions.className = 'veil-actions';
  const open = document.createElement('a');
  open.className = 'btn btn-solid';
  open.href = permalink(item);
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Open on Instagram';
  const skip = document.createElement('button');
  skip.className = 'btn';
  skip.type = 'button';
  skip.textContent = 'Skip';
  const drop = document.createElement('button');
  drop.className = 'btn';
  drop.type = 'button';
  drop.textContent = 'Hide for good';
  const retry = document.createElement('button');
  retry.className = 'btn';
  retry.type = 'button';
  retry.textContent = 'Try again';
  actions.append(open, skip, drop, retry);
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
        toast('Tap again to reach Instagram\'s controls there.');
      });
      pads.push(pad);
    }
  }
  clip.append(iframe, ...pads, veil);
  el.append(clip);

  // Reels start out assuming a tall video; MEASURE corrects it if not.
  const slide = { code, item, el, clip, iframe, label, state: 'idle', timer: null, tall: item.kind !== 'post', boxRatio: 0, measured: 0 };
  iframe.addEventListener('load', () => onFrameLoad(slide));
  skip.addEventListener('click', () => go(1));
  drop.addEventListener('click', hideCurrent);
  retry.addEventListener('click', () => loadSlide(slide));
  layoutSlide(slide);
  loadSlide(slide);
  return slide;
}

function disposeSlide(slide) {
  if (!slide) return;
  clearTimeout(slide.timer);
  slide.el.remove();
}

function disposePreload() {
  clearTimeout(preloadTimer);
  disposeSlide(preloadSlide);
  preloadSlide = null;
}

function schedulePreload() {
  clearTimeout(preloadTimer);
  const nextCode = S.queue[S.pos + 1];
  if (preloadSlide && preloadSlide.code !== nextCode) disposePreload();
  if (!nextCode || preloadSlide) return;
  const connection = navigator.connection;
  if (connection && connection.saveData) return;
  preloadTimer = setTimeout(() => {
    if (S.queue[S.pos + 1] !== nextCode || preloadSlide) return;
    preloadSlide = makeSlide(nextCode);
    preloadSlide.el.classList.add('is-preload');
    stage.append(preloadSlide.el);
    layoutSlide(preloadSlide);
  }, PRELOAD_DELAY_MS);
}

function showSlide(code, direction) {
  let slide;
  if (preloadSlide && preloadSlide.code === code) {
    slide = preloadSlide;
    preloadSlide = null;
    clearTimeout(preloadTimer);
    slide.el.classList.remove('is-preload');
  } else {
    disposePreload();
    slide = makeSlide(code);
    stage.append(slide.el);
    layoutSlide(slide);
  }
  const old = currentSlide;
  currentSlide = slide;
  if (old && !reducedMotion.matches && slide.el.animate) {
    const timing = { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
    const from = direction > 0 ? '100%' : '-100%';
    const to = direction > 0 ? '-100%' : '100%';
    slide.el.animate([{ transform: `translateY(${from})` }, { transform: 'none' }], timing);
    const leaving = old.el.animate([{ transform: 'none' }, { transform: `translateY(${to})` }], timing);
    const done = () => disposeSlide(old);
    leaving.finished.then(done, done);
  } else {
    disposeSlide(old);
  }
}

// Put S.queue[S.pos] on screen and bring every label in line with it.
function present(direction) {
  const code = S.queue[S.pos];
  const empty = $('empty');
  if (!code) {
    disposePreload();
    disposeSlide(currentSlide);
    currentSlide = null;
    empty.hidden = false;
    $('empty-text').textContent = S.filters.favOnly && S.favs.size === 0
      ? 'You have not starred anything yet.'
      : 'No saved items fit the current filters.';
  } else {
    empty.hidden = true;
    S.seen.add(code);
    if (S.mode === 'newest') S.newestCode = code;
    if (!currentSlide || currentSlide.code !== code) showSlide(code, direction);
    schedulePreload();
  }
  renderChrome();
  saveSoon();
}

/* Labels around the stage ------------------------------------------------ */

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function filterSummary() {
  const f = S.filters;
  const parts = [];
  if (f.account) parts.push(`@${f.account}`);
  if (f.collection) parts.push(f.collection);
  if (f.favOnly) parts.push('Starred');
  return parts.join(' + ');
}

function renderChrome() {
  const total = S.queue.length;
  const item = S.items.get(S.queue[S.pos]);
  const n = item ? S.pos + 1 : 0;
  $('counter-n').textContent = String(n).padStart(String(total).length, '0');
  $('counter-m').textContent = String(total);
  const percent = total ? (n / total) * 100 : 0;
  $('progress-fill').style.width = `${percent}%`;
  $('progress-fill').parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));

  $('mode-shuffle').setAttribute('aria-pressed', String(S.mode === 'shuffle'));
  $('mode-newest').setAttribute('aria-pressed', String(S.mode === 'newest'));
  $('btn-reshuffle').disabled = S.mode !== 'shuffle' || !item;

  const note = $('filter-note');
  const summary = filterSummary();
  note.hidden = !summary;
  note.textContent = summary;

  for (const id of ['btn-prev', 'btn-next', 'btn-fav', 'btn-hide']) $(id).disabled = !item;
  const open = $('btn-open');
  const user = $('meta-user');
  const caption = $('meta-caption');
  if (!item) {
    open.removeAttribute('href');
    user.textContent = '';
    $('meta-date').textContent = '';
    caption.textContent = '';
    caption.disabled = true;
    return;
  }
  open.href = permalink(item);
  user.textContent = item.user ? `@${item.user}` : 'Unknown account';
  user.disabled = !item.user;
  user.title = S.filters.account === item.user ? 'Show all accounts again' : 'Show only this account';
  $('meta-date').textContent = item.savedAt ? `Saved ${dateFormat.format(item.savedAt)}` : (item.collections[0] || '');
  const text = (item.caption || '').replace(/\s+/g, ' ').trim();
  caption.textContent = text || 'No caption';
  caption.disabled = !text;
  $('btn-fav').setAttribute('aria-pressed', String(S.favs.has(item.code)));
}

function closeCaption() {
  $('caption-full').hidden = true;
  $('meta-caption').setAttribute('aria-expanded', 'false');
}

function toggleCaption() {
  const box = $('caption-full');
  const item = S.items.get(S.queue[S.pos]);
  if (!box.hidden || !item || !item.caption) {
    closeCaption();
    return;
  }
  box.textContent = item.caption;
  box.hidden = false;
  box.scrollTop = 0;
  $('meta-caption').setAttribute('aria-expanded', 'true');
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

/* Item actions ----------------------------------------------------------- */

function toggleFav() {
  const code = S.queue[S.pos];
  if (!code) return;
  if (S.favs.has(code)) S.favs.delete(code);
  else S.favs.add(code);
  if (S.filters.favOnly && !S.favs.has(code)) refreshQueue();
  else {
    renderChrome();
    saveSoon();
  }
}

function hideCurrent() {
  const code = S.queue[S.pos];
  if (!code) return;
  S.hidden.add(code);
  refreshQueue();
  toast('Hidden from rotation. Restore it from the library panel.');
}

function toggleAccount(user) {
  S.filters.account = S.filters.account === user ? null : user;
  refreshQueue();
  renderDrawer();
  toast(S.filters.account ? `Only @${user}. Tap the name again for everyone.` : 'Showing every account again.');
}

/* Library panel ---------------------------------------------------------- */

const drawer = $('drawer');
let lastFocus = null;

function openDrawer() {
  lastFocus = document.activeElement;
  renderDrawer();
  drawer.hidden = false;
  $('scrim').hidden = false;
  $('drawer-close').focus();
}

function closeDrawer() {
  if (drawer.hidden) return;
  drawer.hidden = true;
  $('scrim').hidden = true;
  disarmClear();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function renderDrawer() {
  const counts = { reel: 0, post: 0, tv: 0 };
  const accounts = new Map();
  const collections = new Map();
  let fav = 0;
  for (const item of S.items.values()) {
    if (S.hidden.has(item.code)) continue;
    counts[item.kind] += 1;
    if (S.favs.has(item.code)) fav += 1;
    if (item.user && S.filters[item.kind]) accounts.set(item.user, (accounts.get(item.user) || 0) + 1);
    for (const name of item.collections) collections.set(name, (collections.get(name) || 0) + 1);
  }
  const seenCount = S.queue.filter((code) => S.seen.has(code)).length;
  const summary = $('lib-summary');
  summary.replaceChildren();
  const bold = (value) => {
    const b = document.createElement('b');
    b.textContent = String(value);
    return b;
  };
  summary.append(bold(S.items.size), ' saved items. ', bold(S.queue.length), ' in the current selection, ', bold(seenCount), ' of them watched.');

  for (const kind of ['reel', 'post', 'tv']) {
    $(`f-${kind}`).checked = S.filters[kind];
    $(`n-${kind}`).textContent = String(counts[kind]);
  }
  $('s-crop').checked = S.settings.crop;
  $('f-fav').checked = S.filters.favOnly;
  $('n-fav').textContent = String(fav);

  const select = $('collection-select');
  $('sec-collection').hidden = collections.size === 0;
  select.replaceChildren(new Option('All saved items', ''));
  for (const [name, count] of [...collections].sort((a, b) => a[0].localeCompare(b[0]))) {
    select.append(new Option(`${name} (${count})`, name));
  }
  select.value = S.filters.collection || '';

  const current = $('account-current');
  current.hidden = !S.filters.account;
  current.replaceChildren();
  if (S.filters.account) {
    const clear = document.createElement('button');
    clear.className = 'textbtn';
    clear.type = 'button';
    clear.textContent = 'Show everyone';
    clear.addEventListener('click', () => toggleAccount(S.filters.account));
    current.append(`Only @${S.filters.account}`, clear);
  }
  renderAccounts(accounts);

  $('rotation-note').textContent = S.mode === 'shuffle'
    ? 'Shuffle goes through everything once before anything repeats, then deals a fresh order.'
    : 'Newest runs from your latest save back to your first. What you watch here also counts as watched in Shuffle.';
  const restore = $('btn-restore');
  restore.hidden = S.hidden.size === 0;
  restore.textContent = `Restore ${S.hidden.size} hidden`;

  const last = S.lastImport;
  $('last-import').textContent = S.isDefault
    ? `Showing the ${S.items.size} saves that come with this copy of the site. Import your own to replace them.`
    : last
    ? `Last import ${dateFormat.format(last.at)}: ${last.links} links, ${last.unique} unique, ${last.added} new.`
    : 'No import recorded yet.';
  $('storage-warning').hidden = store.isPersistent();
}

let accountCache = [];
function renderAccounts(accounts) {
  if (accounts) accountCache = [...accounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const query = $('account-search').value.trim().toLowerCase().replace(/^@/, '');
  const matches = query ? accountCache.filter(([name]) => name.toLowerCase().includes(query)) : accountCache;
  const list = $('account-list');
  list.replaceChildren();
  const LIMIT = 40;
  for (const [name, count] of matches.slice(0, LIMIT)) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(S.filters.account === name));
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = `@${name}`;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(count);
    button.append(label, num);
    button.addEventListener('click', () => toggleAccount(name));
    li.append(button);
    list.append(li);
  }
  if (matches.length > LIMIT || matches.length === 0) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = matches.length === 0
      ? 'No account matches.'
      : `${matches.length - LIMIT} more. Search to narrow it down.`;
    list.append(li);
  }
}

let clearArmed = null;
function disarmClear() {
  clearTimeout(clearArmed);
  clearArmed = null;
  const button = $('btn-clear');
  button.classList.remove('is-armed');
  button.textContent = 'Erase all data';
}

async function clearEverything() {
  const button = $('btn-clear');
  if (!clearArmed) {
    button.classList.add('is-armed');
    button.textContent = 'Press again to erase everything';
    clearArmed = setTimeout(disarmClear, 5000);
    return;
  }
  disarmClear();
  clearTimeout(saveTimer);
  saveTimer = null;
  await store.clearAll();
  S.items.clear();
  S.seen.clear();
  S.hidden.clear();
  S.favs.clear();
  S.filters = { ...DEFAULT_FILTERS };
  S.settings = { ...DEFAULT_SETTINGS };
  S.mode = 'shuffle';
  S.queue = [];
  S.pos = 0;
  S.shuffleStash = null;
  S.newestCode = null;
  S.lastImport = null;
  S.isDefault = false;
  try {
    localStorage.setItem('skip-default', '1');
  } catch { /* storage unavailable */ }
  disposePreload();
  disposeSlide(currentSlide);
  currentSlide = null;
  drawer.hidden = true;
  $('scrim').hidden = true;
  showImport();
  toast('Everything stored in this browser has been erased.');
}

/* Import ----------------------------------------------------------------- */

function showImport() {
  const hasLibrary = S.items.size > 0;
  $('view-player').hidden = true;
  $('view-import').hidden = false;
  $('import-report').hidden = true;
  $('btn-back').hidden = !hasLibrary;
  setStatus('');
  $('import-title').textContent = S.isDefault
    ? 'Import your own saves.'
    : hasLibrary
    ? 'Bring in a newer export.'
    : 'Your saved reels, in an order you did not pick.';
  $('import-lede').textContent = S.isDefault
    ? 'You are watching the list that comes with this copy of the site. Import your own Instagram export and it replaces that list in this browser.'
    : hasLibrary
    ? `You have ${S.items.size} saved items here. Import a fresh export and anything new is added; what you have watched, hidden or starred is left alone.`
    : 'Instagram keeps your saves in one long list you never scroll back through. Hand this page your own data export and it deals them out at random, or newest first, one at a time.';
  window.scrollTo(0, 0);
}

function showPlayer() {
  $('view-import').hidden = true;
  $('view-player').hidden = false;
  layoutStage();
  refreshQueue();
}

function setStatus(message, isError = false) {
  const el = $('import-status');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
}

function renderReport(stats, files) {
  const list = $('report-list');
  list.replaceChildren();
  const rows = [
    ['Links found', stats.links],
    ['Unique items', stats.unique],
    ['Duplicates dropped', stats.duplicates],
    ['Reels', stats.reel],
    ['Posts', stats.post],
    ['IGTV videos', stats.tv],
    ['New to your library', stats.added, true],
    ['Already in your library', stats.known],
  ];
  for (const [label, value, total] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    if (total) {
      dt.className = 'is-total';
      dd.className = 'is-total';
    }
    list.append(dt, dd);
  }
  const fileList = $('report-files');
  fileList.replaceChildren();
  for (const file of files) {
    const li = document.createElement('li');
    li.textContent = file.error ? `${file.name}: ${file.error}` : `${file.name}: ${file.links} links`;
    if (file.error) li.className = 'is-error';
    fileList.append(li);
  }
  $('import-report').hidden = false;
}

let importing = false;
async function importFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0 || importing) return;
  importing = true;
  if ($('view-import').hidden) {
    closeDrawer();
    showImport();
  }
  $('import-report').hidden = true;
  setStatus(`Reading ${files.length === 1 ? files[0].name : `${files.length} files`}...`);
  try {
    const parsed = await parseFiles(files);
    // Someone importing their own export replaces the bundled list outright.
    if (S.isDefault && parsed.entries.length > 0) {
      S.items.clear();
      S.seen.clear();
      S.hidden.clear();
      S.favs.clear();
      S.filters = { ...DEFAULT_FILTERS };
      S.queue = [];
      S.pos = 0;
      S.shuffleStash = null;
      S.newestCode = null;
      S.isDefault = false;
      disposePreload();
      disposeSlide(currentSlide);
      currentSlide = null;
    }
    const stats = mergeEntries(S.items, parsed.entries);
    if (stats.links === 0) {
      const firstError = parsed.files.find((file) => file.error);
      setStatus(firstError ? firstError.error : 'No Instagram post or reel links were found in that. Is it the "Saved" part of the export?', true);
      return;
    }
    S.lastImport = { at: Date.now(), links: stats.links, unique: stats.unique, added: stats.added };
    const stored = await store.set('items', [...S.items.values()]);
    await saveState();
    renderReport(stats, parsed.files);
    $('btn-start').textContent = stats.added === S.items.size ? 'Start watching' : 'Back to the player';
    try {
      localStorage.removeItem('skip-default');
    } catch { /* storage unavailable */ }
    $('btn-back').hidden = true;
    setStatus(stored ? 'Done. Stored in this browser only.' : 'Done, but this browser would not store it; it will be gone when the tab closes.', !stored);
    $('import-report').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    setStatus(err && err.message ? err.message : 'That file could not be read.', true);
  } finally {
    importing = false;
    $('file-input').value = '';
  }
}

/* Input wiring ----------------------------------------------------------- */

function wire() {
  $('file-input').addEventListener('change', (event) => importFiles(event.target.files));
  $('btn-start').addEventListener('click', showPlayer);
  $('btn-back').addEventListener('click', showPlayer);

  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    dragDepth += 1;
    $('dragveil').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('dragveil').hidden = true;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    $('dragveil').hidden = true;
    importFiles(event.dataTransfer.files);
  });

  $('mode-shuffle').addEventListener('click', () => setMode('shuffle'));
  $('mode-newest').addEventListener('click', () => setMode('newest'));
  $('btn-prev').addEventListener('click', () => go(-1));
  $('btn-next').addEventListener('click', () => go(1));
  $('btn-fav').addEventListener('click', toggleFav);
  $('btn-hide').addEventListener('click', hideCurrent);
  $('btn-reshuffle').addEventListener('click', reshuffle);
  $('meta-caption').addEventListener('click', toggleCaption);
  $('meta-user').addEventListener('click', () => {
    const item = S.items.get(S.queue[S.pos]);
    if (item && item.user) toggleAccount(item.user);
  });

  $('btn-menu').addEventListener('click', openDrawer);
  $('filter-note').addEventListener('click', openDrawer);
  $('btn-empty-filters').addEventListener('click', openDrawer);
  $('drawer-close').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);

  for (const kind of ['reel', 'post', 'tv']) {
    $(`f-${kind}`).addEventListener('change', (event) => {
      S.filters[kind] = event.target.checked;
      refreshQueue();
      renderDrawer();
    });
  }
  $('f-fav').addEventListener('change', (event) => {
    S.filters.favOnly = event.target.checked;
    refreshQueue();
    renderDrawer();
  });
  $('collection-select').addEventListener('change', (event) => {
    S.filters.collection = event.target.value || null;
    refreshQueue();
    renderDrawer();
  });
  $('s-crop').addEventListener('change', (event) => {
    S.settings.crop = event.target.checked;
    layoutStage();
    saveSoon();
  });
  $('account-search').addEventListener('input', () => renderAccounts());
  $('btn-restart').addEventListener('click', () => {
    S.seen.clear();
    if (S.mode === 'shuffle') {
      S.queue = [];
      S.pos = 0;
    } else {
      S.shuffleStash = null;
    }
    refreshQueue();
    renderDrawer();
    toast('Everything is marked unwatched.');
  });
  $('btn-restore').addEventListener('click', () => {
    const count = S.hidden.size;
    S.hidden.clear();
    refreshQueue();
    renderDrawer();
    toast(`${count} back in rotation.`);
  });
  $('btn-update').addEventListener('click', () => {
    closeDrawer();
    showImport();
  });
  $('btn-clear').addEventListener('click', clearEverything);

  // Keyboard.
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (!$('caption-full').hidden) closeCaption();
      else closeDrawer();
      return;
    }
    if ($('view-player').hidden || !drawer.hidden) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const onButton = /^(BUTTON|A)$/.test(event.target.tagName);
    if (key === 'ArrowDown' || key === 'j' || key === 'PageDown' || (key === ' ' && !onButton)) go(1);
    else if (key === 'ArrowUp' || key === 'k' || key === 'PageUp') go(-1);
    else if (key === 'f') toggleFav();
    else if (key === 'h') hideCurrent();
    else if (key === 'r') reshuffle();
    else if (key === 'o') {
      const item = S.items.get(S.queue[S.pos]);
      if (item) window.open(permalink(item), '_blank', 'noopener,noreferrer');
    } else return;
    event.preventDefault();
  });

  // Swipe on anything that is ours (the embed swallows its own touches).
  const player = $('view-player');
  let touch = null;
  player.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.target.closest('.caption-full')) {
      touch = null;
      return;
    }
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
  }, { passive: true });
  player.addEventListener('touchend', (event) => {
    if (!touch) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touch.x;
    const dy = end.clientY - touch.y;
    const quick = Date.now() - touch.at < 800;
    touch = null;
    if (quick && Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx) * 1.3) go(dy < 0 ? 1 : -1);
  }, { passive: true });

  // Wheel / trackpad, one step per gesture.
  let wheelLock = 0;
  player.addEventListener('wheel', (event) => {
    if (event.target.closest('.caption-full')) return;
    const now = Date.now();
    if (Math.abs(event.deltaY) < 24 || now < wheelLock) return;
    wheelLock = now + 650;
    go(event.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener('message', onEmbedMessage);
  new ResizeObserver(layoutStage).observe(stage);
  window.addEventListener('online', () => {
    if (currentSlide && currentSlide.state === 'failed') loadSlide(currentSlide);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) saveState();
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer) saveState();
  });

  // Install prompt, where the browser offers one.
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    $('btn-install').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $('btn-install').hidden = true;
  });
}

// First visit with nothing stored: use the list this copy of the site ships
// with, if there is one at default/saved_posts.html.
async function loadDefaultList() {
  try {
    if (localStorage.getItem('skip-default') === '1') return;
  } catch { /* storage unavailable */ }
  try {
    const response = await fetch('default/saved_posts.html', { cache: 'no-store' });
    if (!response.ok) return;
    const stats = mergeEntries(S.items, parseText(await response.text()));
    if (stats.unique === 0) return;
    S.isDefault = true;
    S.lastImport = { at: Date.now(), links: stats.links, unique: stats.unique, added: stats.added };
    await store.set('items', [...S.items.values()]);
    await saveState();
  } catch { /* no bundled list; fall through to the import screen */ }
}

async function init() {
  wire();
  await loadAll();
  if (S.items.size === 0) await loadDefaultList();
  if (S.items.size > 0) showPlayer();
  else showImport();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
