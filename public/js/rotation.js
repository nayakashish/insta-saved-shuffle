// What plays next. Owns the queue and every action that changes it; knows
// nothing about the DOM. Listeners hear about changes through 'rotation'.

import { S, ALL, saveSoon } from './state.js';
import { emit, toast } from './events.js';
import { eligibleCodes, sameScope, scopeLabel, siblings } from './library.js';
import { newCycle, rebuildQueue, reshuffleRemaining } from './queue.js';

// Only while the player is on screen does a queue change put a reel up (and
// mark it watched). Elsewhere changes are just recorded for later.
let active = false;

export const currentCode = () => S.queue[S.pos];
export const currentItem = () => S.items.get(S.queue[S.pos]);
export const upcoming = (count) => S.queue.slice(S.pos + 1, S.pos + 1 + count);

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

function commit(direction) {
  const code = currentCode();
  if (code) {
    S.seen.add(code);
    if (S.mode === 'newest') S.newestCode = code;
  }
  emit('rotation', { direction });
  saveSoon();
}

// Recompute the queue after anything that changes what is eligible.
export function refresh() {
  if (!active) {
    saveSoon();
    return;
  }
  const eligible = eligibleCodes();
  const current = currentCode();
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
      toast(`You have been through all ${eligible.length} here. Starting a fresh round.`);
    } else {
      S.queue = next.queue;
      S.pos = next.pos;
    }
  }
  commit(1);
}

export function setActive(value) {
  active = value;
  if (active) refresh();
}

export function go(direction) {
  const total = S.queue.length;
  if (total === 0) return;
  if (direction > 0) {
    if (S.pos < total - 1) {
      S.pos += 1;
    } else if (S.mode === 'newest') {
      toast('That is the oldest save here.');
      return;
    } else if (total === 1) {
      toast('Only one item here right now.');
      return;
    } else {
      startNewCycle(S.queue.slice(), currentCode());
      toast(`You have been through all ${total}. Reshuffled for a fresh round.`);
    }
  } else if (S.pos > 0) {
    S.pos -= 1;
  } else {
    toast(S.mode === 'newest' ? 'That is the latest save here.' : 'This is where the round started.');
    return;
  }
  commit(direction);
}

export function setMode(mode) {
  if (mode === S.mode) return;
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
  refresh();
}

export function setScope(scope) {
  if (sameScope(scope, S.scope)) return;
  S.scope = { type: scope.type, value: scope.value ?? null };
  // Newest-first restarts from the top of the new selection.
  if (S.mode === 'newest') {
    S.queue = [];
    S.pos = 0;
    S.newestCode = null;
  }
  refresh();
}

// Step to the neighbouring topic / tag / account / collection.
export function cycleScope(direction) {
  const ring = siblings();
  if (ring.length < 2) {
    toast('Nothing else to step through here.');
    return;
  }
  const at = ring.findIndex((scope) => sameScope(scope, S.scope));
  const next = ring[(Math.max(0, at) + direction + ring.length) % ring.length];
  setScope(next);
  toast(scopeLabel(next));
}

export function reshuffle() {
  if (S.mode !== 'shuffle') {
    toast('Mix applies to Shuffle order.');
    return;
  }
  const left = S.queue.length - S.pos - 1;
  if (left < 2) {
    toast('Nothing left to mix in this round.');
    return;
  }
  S.queue = reshuffleRemaining({ queue: S.queue, pos: S.pos }).queue;
  emit('rotation', { direction: 0 });
  saveSoon();
  toast(`Mixed the ${left} you have not seen yet.`);
}

export function toggleFav() {
  const code = currentCode();
  if (!code) return;
  if (S.favs.has(code)) S.favs.delete(code);
  else S.favs.add(code);
  if (S.scope.type === 'starred' && !S.favs.has(code)) refresh();
  else {
    emit('rotation', { direction: 0 });
    saveSoon();
  }
}

export function hideCurrent() {
  const code = currentCode();
  if (!code) return;
  S.hidden.add(code);
  refresh();
  toast('Hidden from rotation. Restore it in Settings.');
}

// The player found that an embed cannot play here. Remember it, and if it
// was still ahead in the queue, drop it before the viewer reaches it.
export function reportBroken(code) {
  if (S.broken.has(code)) return;
  S.broken.add(code);
  saveSoon();
  if (!S.settings.skipBroken || S.scope.type === 'broken' || code === currentCode()) return;
  const at = S.queue.indexOf(code);
  if (at > S.pos) {
    S.queue.splice(at, 1);
    emit('rotation', { direction: 0 });
  }
}

export function reportPlayable(code) {
  if (S.broken.delete(code)) saveSoon();
}

export function toggleScopeAccount(user) {
  setScope(S.scope.type === 'account' && S.scope.value === user ? ALL : { type: 'account', value: user });
}
