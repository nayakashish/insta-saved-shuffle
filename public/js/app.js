// Entry point: load state, wire the modules together, route between views.
//
//   #/         start page        ui/home.js
//   #/watch    player            ui/watch.js + player.js + rotation.js
//   #/import   import / update   ui/importer.js
//   #/privacy  privacy notes     static markup in index.html

import { S, loadAll, indexItem, saveItems, saveState } from './state.js';
import { on } from './events.js';
import { parseText, mergeEntries } from './parser.js';
import { setActive } from './rotation.js';
import { initPlayer, setPlayerActive, layoutStage } from './player.js';
import { $ } from './ui/dom.js';
import { initToast } from './ui/toast.js';
import { renderHome } from './ui/home.js';
import { initWatch } from './ui/watch.js';
import { initSettings, closeSettings } from './ui/settings.js';
import { initImporter, renderImport } from './ui/importer.js';

const ROUTES = { '': 'home', '#/': 'home', '#/watch': 'watch', '#/import': 'import', '#/privacy': 'privacy' };
const VIEWS = ['home', 'watch', 'import', 'privacy'];
let shown = null;

function route() {
  let name = ROUTES[location.hash] || 'home';
  // With no library there is nothing to browse or play: start at import.
  if (S.items.size === 0 && (name === 'home' || name === 'watch')) {
    name = 'import';
    history.replaceState(null, '', '#/import');
  }
  closeSettings();
  if (name !== 'watch') {
    setActive(false);
    setPlayerActive(false);
  }
  for (const view of VIEWS) $(`view-${view}`).hidden = view !== name;
  if (name === 'home') renderHome();
  if (name === 'import') renderImport();
  if (name === 'watch') {
    setPlayerActive(true);
    setActive(true);
  }
  if (name !== shown) window.scrollTo(0, 0);
  shown = name;
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
    for (const item of S.items.values()) indexItem(item);
    S.isDefault = true;
    S.lastImport = { at: Date.now(), links: stats.links, unique: stats.unique, added: stats.added };
    await saveItems();
    await saveState();
  } catch { /* no bundled list; fall through to the import screen */ }
}

async function init() {
  initToast();
  initSettings();
  initImporter();
  initWatch();
  initPlayer($('stage'));
  on('layout', layoutStage);
  on('library', () => {
    if (shown === 'home') renderHome();
  });
  on('erased', route);

  await loadAll();
  if (S.items.size === 0) await loadDefaultList();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
