// The import view: read an export, merge it into the library, report.

import { S, indexItem, resetLibrary, saveItems, saveState } from '../state.js';
import { emit } from '../events.js';
import { parseFiles, mergeEntries } from '../parser.js';
import { $, h, num } from './dom.js';

function setStatus(message, isError = false) {
  const el = $('import-status');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
}

export function renderImport() {
  const hasLibrary = S.items.size > 0;
  $('import-report').hidden = true;
  $('import-back').hidden = !hasLibrary;
  setStatus('');
  $('import-title').textContent = S.isDefault
    ? 'Import your own saves.'
    : hasLibrary
      ? 'Bring in a newer export.'
      : 'Your saved reels, in an order you did not pick.';
  $('import-lede').textContent = S.isDefault
    ? 'You are watching the list that came with this copy of the site. Import your own Instagram export and it replaces that list in this browser.'
    : hasLibrary
      ? `You have ${num(S.items.size)} saves here. Import a fresh export and anything new is added; what you have watched, hidden or starred is left alone.`
      : 'Instagram keeps your saves in one long list you never scroll back through. Hand this page your own data export and it deals them out at random, newest first, or by topic.';
}

function renderReport(stats, files) {
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
  $('report-list').replaceChildren(...rows.flatMap(([label, value, total]) => [
    h('dt', { class: total ? 'is-total' : null }, label),
    h('dd', { class: total ? 'is-total' : null }, num(value)),
  ]));
  $('report-files').replaceChildren(...files.map((file) =>
    h('li', { class: file.error ? 'is-error' : null }, file.error ? `${file.name}: ${file.error}` : `${file.name}: ${num(file.links)} links`)));
  $('import-report').hidden = false;
}

let importing = false;

export async function importFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0 || importing) return;
  importing = true;
  if (location.hash !== '#/import') location.hash = '#/import';
  $('import-report').hidden = true;
  setStatus(`Reading ${files.length === 1 ? files[0].name : `${files.length} files`}...`);
  try {
    const parsed = await parseFiles(files);
    if (parsed.entries.length === 0) {
      const firstError = parsed.files.find((file) => file.error);
      setStatus(firstError ? firstError.error : 'No Instagram post or reel links were found in that. Is it the "Saved" part of the export?', true);
      return;
    }
    // Someone importing their own export replaces a bundled list outright.
    if (S.isDefault) resetLibrary();
    const stats = mergeEntries(S.items, parsed.entries);
    for (const item of S.items.values()) indexItem(item);
    S.lastImport = { at: Date.now(), links: stats.links, unique: stats.unique, added: stats.added };
    try {
      localStorage.removeItem('skip-default');
    } catch { /* storage unavailable */ }
    const stored = await saveItems();
    await saveState();
    emit('library');
    renderReport(stats, parsed.files);
    $('import-back').hidden = false;
    setStatus(stored ? 'Done. Stored in this browser only.' : 'Done, but this browser would not store it; it will be gone when the tab closes.', !stored);
    $('import-report').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    setStatus(err && err.message ? err.message : 'That file could not be read.', true);
  } finally {
    importing = false;
    $('file-input').value = '';
  }
}

export function initImporter() {
  $('file-input').addEventListener('change', (event) => importFiles(event.target.files));

  // Drag and drop anywhere, on any view.
  let depth = 0;
  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    $('dragveil').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) $('dragveil').hidden = true;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    $('dragveil').hidden = true;
    importFiles(event.dataTransfer.files);
  });
}
