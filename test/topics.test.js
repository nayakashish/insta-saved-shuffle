import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, extractTags, topicsFor, isNoiseTag, topicLabel, UNSORTED } from '../public/js/topics.js';

test('extractTags lowercases, de-duplicates and keeps order', () => {
  assert.deepEqual(extractTags('Shaving cream #Prank #fyp #prank\n#funny.'), ['prank', 'fyp', 'funny']);
  assert.deepEqual(extractTags(''), []);
  assert.deepEqual(extractTags(null), []);
});

test('extractTags handles non-latin hashtags', () => {
  assert.deepEqual(extractTags('#fypシ #bateria'), ['fypシ', 'bateria']);
});

test('noise tags are recognised', () => {
  for (const tag of ['fyp', 'fypシ', 'viralreels', 'explorepage', 'reelsinstagram', 'foryoupage']) assert.ok(isNoiseTag(tag), tag);
  for (const tag of ['drums', 'coding', 'f1']) assert.ok(!isNoiseTag(tag), tag);
});

test('topics match by stem and by exact word', () => {
  assert.deepEqual(topicsFor(['worshipdrummer']), ['drums', 'faith']);
  assert.deepEqual(topicsFor(['programmingmemes']), ['comedy', 'code']);
  assert.ok(topicsFor(['car']).includes('cars'));
  assert.ok(!topicsFor(['scar']).includes('cars'), 'exact patterns must not match inside other words');
  assert.ok(!topicsFor(['moment']).includes('family'));
  assert.ok(!topicsFor(['planet']).includes('aviation'));
});

test('noise-only tags fall back to caption words', () => {
  assert.deepEqual(topicsFor(['fyp', 'viral'], 'My new drum kit arrived'), ['drums']);
  assert.deepEqual(topicsFor([], 'nothing recognisable here'), []);
});

test('real tags win over caption words', () => {
  assert.deepEqual(topicsFor(['lego'], 'a drum solo'), ['play']);
});

test('taxonomy is well formed', () => {
  const ids = TOPICS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const topic of TOPICS) {
    assert.ok(topic.label && topic.match.length > 0);
    assert.equal(topicLabel(topic.id), topic.label);
  }
  assert.ok(!ids.includes(UNSORTED));
  assert.equal(topicLabel(UNSORTED), 'Everything else');
});
