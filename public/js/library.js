// Read-only questions about the library: what is eligible, what the current
// scope is called, how many items each topic / tag / account holds.

import { S, ALL } from './state.js';
import { TOPICS, UNSORTED, topicLabel, isNoiseTag } from './topics.js';

export const sameScope = (a, b) => a.type === b.type && a.value === b.value;

// In rotation at all: not hidden, of a kind that is switched on, and not
// known to be unplayable here (unless that skipping is turned off).
export const inRotation = (item) =>
  !S.hidden.has(item.code) && S.kinds[item.kind] && !(S.settings.skipBroken && S.broken.has(item.code));

export function scopeMatches(item, scope) {
  switch (scope.type) {
    case 'topic':
      return scope.value === UNSORTED ? item.topics.length === 0 : item.topics.includes(scope.value);
    case 'tag':
      return item.tags.includes(scope.value);
    case 'account':
      return item.user === scope.value;
    case 'collection':
      return item.collections.includes(scope.value);
    case 'starred':
      return S.favs.has(item.code);
    default:
      return true;
  }
}

export function eligibleCodes(scope = S.scope) {
  const out = [];
  // The review list of unplayable saves is the one scope that shows them.
  if (scope.type === 'broken') {
    for (const code of S.broken) if (S.items.has(code) && !S.hidden.has(code)) out.push(code);
    return out;
  }
  for (const item of S.items.values()) {
    if (inRotation(item) && scopeMatches(item, scope)) out.push(item.code);
  }
  return out;
}

export function scopeLabel(scope = S.scope) {
  switch (scope.type) {
    case 'topic':
      return topicLabel(scope.value);
    case 'tag':
      return `#${scope.value}`;
    case 'account':
      return `@${scope.value}`;
    case 'collection':
      return scope.value;
    case 'starred':
      return 'Starred';
    case 'broken':
      return 'Will not play here';
    default:
      return 'Everything';
  }
}

const SCOPE_KIND = { all: 'All saves', topic: 'Topic', tag: 'Tag', account: 'Account', collection: 'Collection', starred: 'Yours', broken: 'Review' };
export const scopeKind = (scope = S.scope) => SCOPE_KIND[scope.type] || '';

function bump(map, key, seen) {
  let entry = map.get(key);
  if (!entry) map.set(key, (entry = { key, count: 0, seen: 0 }));
  entry.count += 1;
  if (seen) entry.seen += 1;
}

const byCount = (a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key));

// One pass over the library. A few thousand items, so this is recomputed on
// demand rather than cached.
export function overview() {
  const kinds = { reel: 0, post: 0, tv: 0 };
  const topics = new Map();
  const tags = new Map();
  const accounts = new Map();
  const collections = new Map();
  const starred = { key: 'starred', count: 0, seen: 0 };
  let total = 0;
  let seenTotal = 0;
  let latest = 0;
  let broken = 0;
  for (const item of S.items.values()) {
    if (S.hidden.has(item.code)) continue;
    if (S.broken.has(item.code)) broken += 1;
    kinds[item.kind] += 1;
    if (S.settings.skipBroken && S.broken.has(item.code)) continue;
    if (!S.kinds[item.kind]) continue;
    const seen = S.seen.has(item.code);
    total += 1;
    if (seen) seenTotal += 1;
    if (item.savedAt > latest) latest = item.savedAt;
    if (item.topics.length === 0) bump(topics, UNSORTED, seen);
    for (const id of item.topics) bump(topics, id, seen);
    for (const tag of item.tags) if (!isNoiseTag(tag)) bump(tags, tag, seen);
    if (item.user) bump(accounts, item.user, seen);
    for (const name of item.collections) bump(collections, name, seen);
    if (S.favs.has(item.code)) {
      starred.count += 1;
      if (seen) starred.seen += 1;
    }
  }
  // Topics keep taxonomy order ties broken by size; "everything else" last.
  const topicList = TOPICS.map((t) => topics.get(t.id)).filter(Boolean).sort(byCount);
  if (topics.has(UNSORTED)) topicList.push(topics.get(UNSORTED));
  return {
    total,
    seen: seenTotal,
    latest,
    kinds,
    starred,
    hidden: S.hidden.size,
    broken,
    topics: topicList,
    tags: [...tags.values()].sort(byCount),
    accounts: [...accounts.values()].sort(byCount),
    collections: [...collections.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// The most common tags inside one topic, for the small print on its tile.
export function topTagsByTopic(limit = 3) {
  const perTopic = new Map();
  for (const item of S.items.values()) {
    if (!inRotation(item)) continue;
    for (const id of item.topics) {
      let counts = perTopic.get(id);
      if (!counts) perTopic.set(id, (counts = new Map()));
      for (const tag of item.tags) if (!isNoiseTag(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [id, counts] of perTopic) {
    out.set(id, [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag));
  }
  return out;
}

// The ring a scope cycles through with "previous / next": topics for the
// broad scopes, otherwise the other tags, accounts or collections.
export function siblings(scope = S.scope) {
  const o = overview();
  const ring = (type, list, min) => {
    const out = list.filter((e) => e.count >= min || e.key === scope.value).map((e) => ({ type, value: e.key }));
    return out.length > 1 ? out : [];
  };
  if (scope.type === 'tag') return ring('tag', o.tags, 3);
  if (scope.type === 'account') return ring('account', o.accounts, 2);
  if (scope.type === 'collection') return ring('collection', o.collections, 1);
  return [{ ...ALL }, ...o.topics.map((e) => ({ type: 'topic', value: e.key }))];
}
