// Pure shuffle / rotation logic. No DOM, no storage: easy to test in Node.

export function shuffle(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Start a fresh cycle over every eligible code. `avoidFirst` keeps the item
// that was just on screen from opening the next cycle.
export function newCycle(eligible, avoidFirst = null, random = Math.random) {
  const queue = shuffle(eligible, random);
  if (queue.length > 1 && queue[0] === avoidFirst) {
    const j = 1 + Math.floor(random() * (queue.length - 1));
    [queue[0], queue[j]] = [queue[j], queue[0]];
  }
  return { queue, pos: 0 };
}

// Re-derive the queue after the eligible set changed (filter toggled, item
// hidden, new import merged). Everything already seen stays in front in its
// original order, everything unseen is shuffled behind it, so nothing repeats
// before the whole list has been shown.
//
// Returns { queue, pos, exhausted }. `exhausted` means every eligible item
// has been seen and the caller should start a new cycle.
export function rebuildQueue(prev, eligible, seen, random = Math.random) {
  const eligibleSet = new Set(eligible);
  const current = prev.queue[prev.pos];
  const head = prev.queue.slice(0, prev.pos + 1).filter((c) => eligibleSet.has(c));
  const inHead = new Set(head);
  const olderSeen = [];
  const unseen = [];
  for (const code of eligible) {
    if (inHead.has(code)) continue;
    (seen.has(code) ? olderSeen : unseen).push(code);
  }
  const queue = [...olderSeen, ...head, ...shuffle(unseen, random)];
  const seenCount = olderSeen.length + head.length;
  if (eligibleSet.has(current)) {
    return { queue, pos: seenCount - 1, exhausted: false };
  }
  if (seenCount >= queue.length) {
    return { queue, pos: Math.max(0, queue.length - 1), exhausted: queue.length > 0 };
  }
  return { queue, pos: seenCount, exhausted: false };
}

// Shuffle only what has not been shown yet in this cycle.
export function reshuffleRemaining(prev, random = Math.random) {
  const head = prev.queue.slice(0, prev.pos + 1);
  const tail = shuffle(prev.queue.slice(prev.pos + 1), random);
  return { queue: [...head, ...tail], pos: prev.pos };
}
