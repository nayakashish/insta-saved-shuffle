// The settings panel (a drawer), shared by the start page and the player.

import { S, saveSoon, eraseEverything, isPersistent } from '../state.js';
import { emit, toast } from '../events.js';
import { overview } from '../library.js';
import { refresh } from '../rotation.js';
import { $, num, formatDate } from './dom.js';

const drawer = () => $('drawer');
let lastFocus = null;
let clearArmed = null;

function render() {
  const o = overview();
  for (const kind of ['reel', 'post', 'tv']) {
    $(`f-${kind}`).checked = S.kinds[kind];
    $(`n-${kind}`).textContent = num(o.kinds[kind]);
  }
  $('s-crop').checked = S.settings.crop;
  $('s-skip').checked = S.settings.skipBroken;
  $('n-broken').textContent = o.broken ? `${num(o.broken)} found` : '';
  $('btn-forget-broken').hidden = S.broken.size === 0;
  const restore = $('btn-restore');
  restore.hidden = S.hidden.size === 0;
  restore.textContent = `Restore ${num(S.hidden.size)} hidden`;
  const last = S.lastImport;
  $('last-import').textContent = S.isDefault
    ? `Showing the ${num(S.items.size)} saves that came with this copy of the site. Import your own to replace them.`
    : last
      ? `${num(S.items.size)} saves. Last import ${formatDate(last.at)}: ${num(last.links)} links, ${num(last.added)} new.`
      : 'No import recorded yet.';
  $('storage-warning').hidden = isPersistent();
}

function disarmClear() {
  clearTimeout(clearArmed);
  clearArmed = null;
  const button = $('btn-clear');
  button.classList.remove('is-armed');
  button.textContent = 'Erase all data';
}

export function openSettings() {
  lastFocus = document.activeElement;
  render();
  drawer().hidden = false;
  $('scrim').hidden = false;
  $('drawer-close').focus();
}

export function closeSettings() {
  if (drawer().hidden) return;
  drawer().hidden = true;
  $('scrim').hidden = true;
  disarmClear();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

export const settingsOpen = () => !drawer().hidden;

// Something about the library changed: requeue, repaint whoever is showing.
function changed() {
  refresh();
  emit('library');
  render();
}

export function initSettings() {
  $('drawer-close').addEventListener('click', closeSettings);
  $('scrim').addEventListener('click', closeSettings);
  // Links inside the panel navigate; close it on the way out.
  drawer().addEventListener('click', (event) => {
    if (event.target.closest('a[href^="#/"]')) closeSettings();
  });

  for (const kind of ['reel', 'post', 'tv']) {
    $(`f-${kind}`).addEventListener('change', (event) => {
      S.kinds[kind] = event.target.checked;
      changed();
    });
  }
  $('s-crop').addEventListener('change', (event) => {
    S.settings.crop = event.target.checked;
    saveSoon();
    emit('layout');
  });
  $('s-skip').addEventListener('change', (event) => {
    S.settings.skipBroken = event.target.checked;
    changed();
  });
  $('btn-forget-broken').addEventListener('click', () => {
    const count = S.broken.size;
    S.broken.clear();
    changed();
    toast(`${num(count)} back in rotation to be checked again.`);
  });
  $('btn-restart').addEventListener('click', () => {
    S.seen.clear();
    S.shuffleStash = null;
    if (S.mode === 'shuffle') {
      S.queue = [];
      S.pos = 0;
    }
    changed();
    toast('Everything is marked unwatched.');
  });
  $('btn-restore').addEventListener('click', () => {
    const count = S.hidden.size;
    S.hidden.clear();
    changed();
    toast(`${num(count)} back in rotation.`);
  });
  $('btn-clear').addEventListener('click', async () => {
    if (!clearArmed) {
      const button = $('btn-clear');
      button.classList.add('is-armed');
      button.textContent = 'Press again to erase everything';
      clearArmed = setTimeout(disarmClear, 5000);
      return;
    }
    await eraseEverything();
    closeSettings();
    lastFocus = null;
    emit('erased');
    toast('Everything stored in this browser has been erased.');
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
