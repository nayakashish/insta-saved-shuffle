// Parses Instagram "Download your information" exports, entirely in the
// browser. Written against the real HTML export layout (Nov 2026):
//
//   saved_posts.html        main > entry > nested tables. Each entry has one
//                           <a href> to the post, a "Caption" row, an "Owner"
//                           section with a "Username" row, and a trailing
//                           leaf <div> holding the saved date.
//   saved_collections.html  one outer table per collection ("Name", "Type",
//                           "Update time" rows) whose "Media" section nests
//                           one table per saved post, same shape as above but
//                           without a per-post saved date.
//
// Class names in the export are obfuscated and change, so everything here
// keys off label text and structure, never class names.

import { readZip } from './zip.js';

export const LINK_RE = /instagram\.com\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;
const LINK_RE_GLOBAL = new RegExp(LINK_RE.source, 'g');
const KIND = { reel: 'reel', reels: 'reel', p: 'post', tv: 'tv' };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DATE_RE = /^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::\d{2})? ?([ap]m)?$/i;

export function parseExportDate(text) {
  const m = DATE_RE.exec(String(text).trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(m[4]);
  const meridiem = (m[6] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5])).getTime();
}

function entryFromMatch(match) {
  return { code: match[2], kind: KIND[match[1]], user: null, name: null, caption: null, savedAt: null, collections: [] };
}

const text = (el) => (el ? el.textContent.trim() : '');

// Value cell that follows a label cell ("Username" -> "someone").
function labelValue(scope, label, ownTable = null) {
  for (const td of scope.querySelectorAll('td')) {
    if (td.children.length === 0 && td.textContent.trim() === label && td.nextElementSibling) {
      if (ownTable && td.closest('table') !== ownTable) continue;
      return text(td.nextElementSibling) || null;
    }
  }
  return null;
}

function ownerSection(table) {
  for (const h of table.querySelectorAll('h1,h2,h3,h4')) {
    if (text(h) === 'Owner') return h.parentElement;
  }
  return null;
}

function savedDateNear(table, stopAt) {
  for (let el = table.parentElement; el && el !== stopAt; el = el.parentElement) {
    for (const child of el.children) {
      if (child.children.length === 0) {
        const t = parseExportDate(child.textContent);
        if (t) return t;
      }
    }
  }
  return null;
}

export function parseHtml(source) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const stopAt = doc.querySelector('main') || doc.body;
  const entries = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const match = LINK_RE.exec(a.getAttribute('href'));
    if (!match) continue;
    const entry = entryFromMatch(match);
    const table = a.closest('table');
    if (table) {
      const owner = ownerSection(table);
      entry.user = (owner && labelValue(owner, 'Username')) || labelValue(table, 'Username');
      entry.name = owner ? labelValue(owner, 'Name') : null;
      entry.caption = labelValue(table, 'Caption', table);
      const outer = table.parentElement ? table.parentElement.closest('table') : null;
      if (outer) {
        const collection = labelValue(outer, 'Name', outer);
        if (collection) entry.collections.push(collection);
      } else {
        entry.savedAt = savedDateNear(table, stopAt);
      }
    }
    entries.push(entry);
  }
  // Unknown layout with no anchors: fall back to scanning the raw text.
  if (entries.length === 0) return parseLoose(source);
  return entries;
}

function parseLoose(source) {
  const entries = [];
  const seen = new Set();
  for (const match of source.matchAll(LINK_RE_GLOBAL)) {
    if (seen.has(match[2])) continue;
    seen.add(match[2]);
    entries.push(entryFromMatch(match));
  }
  return entries;
}

// JSON export (best effort): walk the tree, pick up any { href, timestamp }
// and take the nearest enclosing "title" as the account name.
export function parseJson(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    return parseLoose(source);
  }
  const entries = [];
  const walk = (node, title) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, title);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const here = typeof node.title === 'string' && node.title ? node.title : title;
    if (typeof node.href === 'string') {
      const match = LINK_RE.exec(node.href);
      if (match) {
        const entry = entryFromMatch(match);
        if (here && /^[A-Za-z0-9._]+$/.test(here)) entry.user = here;
        if (typeof node.timestamp === 'number' && node.timestamp > 0) entry.savedAt = node.timestamp * 1000;
        entries.push(entry);
      }
    }
    for (const value of Object.values(node)) walk(value, here);
  };
  walk(data, null);
  return entries.length ? entries : parseLoose(source);
}

export function parseText(source) {
  const start = source.trimStart().slice(0, 1);
  return start === '{' || start === '[' ? parseJson(source) : parseHtml(source);
}

const isZip = (file) => /\.zip$/i.test(file.name) || /zip/.test(file.type);
const wantedInZip = (path) => /(^|\/)[^/]*saved[^/]*\.(html?|json)$/i.test(path) || /(^|\/)saved\/[^/]+\.(html?|json)$/i.test(path);

// files: File[] -> { entries, files: [{ name, links, error }] }
export async function parseFiles(files) {
  const entries = [];
  const reports = [];
  const take = (name, source) => {
    const found = parseText(source);
    reports.push({ name, links: found.length, error: null });
    for (const entry of found) entries.push(entry);
  };
  for (const file of files) {
    try {
      if (isZip(file)) {
        const inner = await readZip(file, wantedInZip);
        if (inner.length === 0) {
          reports.push({ name: file.name, links: 0, error: 'No saved_*.html or saved_*.json files inside this ZIP.' });
        }
        for (const item of inner) take(`${file.name} / ${item.name.split('/').pop()}`, item.text);
      } else {
        take(file.name, await file.text());
      }
    } catch (err) {
      reports.push({ name: file.name, links: 0, error: err && err.message ? err.message : 'Could not read this file.' });
    }
  }
  return { entries, files: reports };
}

// Merge freshly parsed entries into the library (Map code -> item). Existing
// items keep their identity, so seen / hidden / favorite state survives a
// re-import; missing fields are filled in and collections are unioned.
export function mergeEntries(library, entries) {
  const stats = { links: entries.length, unique: 0, duplicates: 0, added: 0, known: 0, reel: 0, post: 0, tv: 0 };
  const inThisImport = new Set();
  for (const entry of entries) {
    if (inThisImport.has(entry.code)) stats.duplicates += 1;
    else {
      inThisImport.add(entry.code);
      stats.unique += 1;
      stats[entry.kind] += 1;
    }
    const existing = library.get(entry.code);
    if (!existing) {
      library.set(entry.code, { ...entry, collections: [...entry.collections] });
      stats.added += 1;
      continue;
    }
    if (!existing.user && entry.user) existing.user = entry.user;
    if (!existing.name && entry.name) existing.name = entry.name;
    if (!existing.caption && entry.caption) existing.caption = entry.caption;
    if (!existing.savedAt && entry.savedAt) existing.savedAt = entry.savedAt;
    // A /reel/ link is more specific than a /p/ link to the same shortcode.
    if (existing.kind === 'post' && entry.kind !== 'post') existing.kind = entry.kind;
    for (const name of entry.collections) {
      if (!existing.collections.includes(name)) existing.collections.push(name);
    }
  }
  stats.known = stats.unique - stats.added;
  return stats;
}
