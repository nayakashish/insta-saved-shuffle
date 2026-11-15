// The one mutable application state object, and its persistence.
//
// Everything here lives in this browser (IndexedDB via store.js). `items` is
// written only when the library changes; the small `state` record is written
// often, debounced.

import * as store from './store.js';
import { extractTags, topicsFor } from './topics.js';

export const DEFAULT_KINDS = { reel: true, post: false, tv: false };
export const DEFAULT_SETTINGS = { crop: true, skipBroken: true };
export const ALL = { type: 'all', value: null };

export const S = {
  items: new Map(), // code -> { code, kind, user, name, caption, savedAt, collections, tags, topics }
  seen: new Set(),
  hidden: new Set(),
  favs: new Set(),
  broken: new Set(), // embeds seen to be unavailable (removed, private, restricted)
  kinds: { ...DEFAULT_KINDS }, // which link kinds are in rotation
  scope: { ...ALL }, // what is being watched: all | topic | tag | account | collection | starred | broken
  settings: { ...DEFAULT_SETTINGS },
  mode: 'shuffle', // 'shuffle' | 'newest'
  queue: [],
  pos: 0,
  shuffleStash: null, // shuffle queue kept while browsing newest-first
  newestCode: null, // where newest-first browsing left off
  lastImport: null,
  isDefault: false, // library is the list bundled with this copy of the site
};

// Derived fields. Tags come from the caption; topics are always recomputed so
// a change to the taxonomy applies to libraries imported earlier.
export function indexItem(item) {
  if (!Array.isArray(item.collections)) item.collections = [];
  item.tags = extractTags(item.caption);
  item.topics = topicsFor(item.tags, item.caption || '');
  return item;
}

let saveTimer = null;

export function saveState() {
  clearTimeout(saveTimer);
  saveTimer = null;
  return store.set('state', {
    version: 2,
    seen: [...S.seen],
    hidden: [...S.hidden],
    favs: [...S.favs],
    broken: [...S.broken],
    kinds: S.kinds,
    scope: S.scope,
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

export function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(saveState, 400);
}

export function flushSave() {
  if (saveTimer) saveState();
}

export function saveItems() {
  return store.set('items', [...S.items.values()]);
}

// Version 1 kept combinable filters; version 2 has kinds plus one scope.
function migrateScope(state) {
  if (state.scope && state.scope.type) return state.scope;
  const f = state.filters || {};
  if (f.account) return { type: 'account', value: f.account };
  if (f.collection) return { type: 'collection', value: f.collection };
  if (f.favOnly) return { type: 'starred', value: null };
  return { ...ALL };
}

export async function loadAll() {
  const [items, state] = await Promise.all([store.get('items'), store.get('state')]);
  if (Array.isArray(items)) for (const item of items) S.items.set(item.code, indexItem(item));
  if (!state) return;
  const f = state.filters || {};
  S.seen = new Set(state.seen || []);
  S.hidden = new Set(state.hidden || []);
  S.favs = new Set(state.favs || []);
  S.broken = new Set(state.broken || []);
  S.kinds = { ...DEFAULT_KINDS, ...(state.kinds || { reel: f.reel ?? true, post: f.post ?? false, tv: f.tv ?? false }) };
  S.scope = migrateScope(state);
  S.settings = { ...DEFAULT_SETTINGS, crop: state.settings?.crop ?? true, skipBroken: state.settings?.skipBroken ?? true };
  S.mode = state.mode === 'newest' ? 'newest' : 'shuffle';
  const savedQueue = state.queue || [];
  const currentCode = savedQueue[state.pos || 0];
  S.queue = savedQueue.filter((code) => S.items.has(code));
  S.pos = Math.max(0, S.queue.indexOf(currentCode));
  S.shuffleStash = state.shuffleStash || null;
  S.newestCode = state.newestCode || null;
  S.lastImport = state.lastImport || null;
  S.isDefault = Boolean(state.isDefault);
}

// Forget the library and everything about it, in memory only.
export function resetLibrary() {
  S.items.clear();
  S.seen.clear();
  S.hidden.clear();
  S.favs.clear();
  S.broken.clear();
  S.kinds = { ...DEFAULT_KINDS };
  S.scope = { ...ALL };
  S.mode = 'shuffle';
  S.queue = [];
  S.pos = 0;
  S.shuffleStash = null;
  S.newestCode = null;
  S.lastImport = null;
  S.isDefault = false;
}

export async function eraseEverything() {
  clearTimeout(saveTimer);
  saveTimer = null;
  await store.clearAll();
  resetLibrary();
  S.settings = { ...DEFAULT_SETTINGS };
  try {
    localStorage.setItem('skip-default', '1');
  } catch { /* storage unavailable */ }
}

export const isPersistent = () => store.isPersistent();
