import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, newCycle, rebuildQueue, reshuffleRemaining } from '../public/js/queue.js';

const codes = (n) => Array.from({ length: n }, (_, i) => `c${i}`);

test('shuffle keeps every element exactly once', () => {
  const input = codes(200);
  const out = shuffle(input);
  assert.equal(out.length, 200);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.notDeepEqual(out, input);
});

test('newCycle never opens with the item just shown', () => {
  for (let i = 0; i < 200; i++) {
    const { queue, pos } = newCycle(codes(3), 'c1');
    assert.equal(pos, 0);
    assert.notEqual(queue[0], 'c1');
    assert.equal(new Set(queue).size, 3);
  }
});

test('walking a cycle shows each item once', () => {
  const { queue } = newCycle(codes(50));
  assert.equal(new Set(queue).size, 50);
});

test('rebuildQueue keeps history and current, shuffles only unseen', () => {
  const all = codes(20);
  const prev = { queue: all, pos: 4 };
  const seen = new Set(all.slice(0, 5));
  const r = rebuildQueue(prev, all, seen);
  assert.deepEqual(r.queue.slice(0, 5), all.slice(0, 5));
  assert.equal(r.pos, 4);
  assert.equal(r.exhausted, false);
  assert.equal(new Set(r.queue).size, 20);
});

test('rebuildQueue moves on when the current item is no longer eligible', () => {
  const all = codes(10);
  const seen = new Set(all.slice(0, 3));
  const eligible = all.filter((c) => c !== 'c2');
  const r = rebuildQueue({ queue: all, pos: 2 }, eligible, seen);
  assert.equal(r.queue.length, 9);
  assert.equal(r.pos, 2);
  assert.ok(!seen.has(r.queue[r.pos]));
});

test('rebuildQueue does not repeat items seen under an earlier filter', () => {
  const all = codes(10);
  const seen = new Set(['c7', 'c8', 'c0']);
  const r = rebuildQueue({ queue: ['c0', 'c1'], pos: 0 }, all, seen);
  assert.equal(r.queue[r.pos], 'c0');
  const upcoming = r.queue.slice(r.pos + 1);
  assert.ok(!upcoming.includes('c7') && !upcoming.includes('c8'));
  assert.equal(upcoming.length, 7);
});

test('rebuildQueue reports exhaustion when nothing unseen is left', () => {
  const all = codes(4);
  const r = rebuildQueue({ queue: all, pos: 3 }, ['c0', 'c1', 'c2'], new Set(all));
  assert.equal(r.exhausted, true);
  const empty = rebuildQueue({ queue: all, pos: 3 }, [], new Set(all));
  assert.equal(empty.exhausted, false);
  assert.equal(empty.queue.length, 0);
});

test('merging new items appends them to the unseen tail', () => {
  const r = rebuildQueue({ queue: ['a', 'b', 'c'], pos: 1 }, ['a', 'b', 'c', 'd', 'e'], new Set(['a', 'b']));
  assert.deepEqual(r.queue.slice(0, 2), ['a', 'b']);
  assert.equal(r.pos, 1);
  assert.deepEqual([...r.queue.slice(2)].sort(), ['c', 'd', 'e']);
});

test('reshuffleRemaining leaves history untouched', () => {
  const all = codes(100);
  const r = reshuffleRemaining({ queue: all, pos: 9 });
  assert.deepEqual(r.queue.slice(0, 10), all.slice(0, 10));
  assert.deepEqual([...r.queue.slice(10)].sort(), [...all.slice(10)].sort());
  assert.equal(r.pos, 9);
});
