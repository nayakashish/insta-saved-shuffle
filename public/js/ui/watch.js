// Everything around the stage in the player view: labels, buttons, keys,
// swipes. Playback itself is player.js; what plays next is rotation.js.

import { S, ALL, flushSave } from '../state.js';
import { on } from '../events.js';
import { scopeLabel, scopeKind, siblings } from '../library.js';
import { isNoiseTag } from '../topics.js';
import { go, setMode, setScope, cycleScope, reshuffle, toggleFav, hideCurrent, toggleScopeAccount, currentItem } from '../rotation.js';
import { permalink } from '../player.js';
import { $, h, num, formatDate, tidyCaption } from './dom.js';
import { openSettings, closeSettings, settingsOpen } from './settings.js';

const view = () => $('view-watch');
const visible = () => !view().hidden;

function closeCaption() {
  $('now').classList.remove('is-open');
  $('now-caption').setAttribute('aria-expanded', 'false');
}

function toggleCaption() {
  const open = $('now').classList.toggle('is-open');
  $('now-caption').setAttribute('aria-expanded', String(open));
}

function render() {
  if (!visible()) return;
  const total = S.queue.length;
  const item = currentItem();
  const n = item ? S.pos + 1 : 0;
  $('counter-n').textContent = String(n).padStart(String(total).length, '0');
  $('counter-m').textContent = num(total);
  const percent = total ? (n / total) * 100 : 0;
  $('progress-fill').style.width = `${percent}%`;
  $('progress-fill').parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));

  $('mode-shuffle').setAttribute('aria-pressed', String(S.mode === 'shuffle'));
  $('mode-newest').setAttribute('aria-pressed', String(S.mode === 'newest'));
  $('btn-reshuffle').disabled = S.mode !== 'shuffle' || !item;

  $('scope-kind').textContent = scopeKind();
  $('scope-name').textContent = scopeLabel();
  const canStep = siblings().length > 1;
  $('scope-prev').disabled = !canStep;
  $('scope-next').disabled = !canStep;

  $('empty').hidden = Boolean(item);
  for (const id of ['btn-prev', 'btn-next', 'btn-fav', 'btn-hide']) $(id).disabled = !item;
  const open = $('btn-open');
  const user = $('now-user');
  const caption = $('now-caption');
  const tags = $('now-tags');
  if (!item) {
    $('empty-text').textContent = S.scope.type === 'all'
      ? 'Nothing is switched on. Open Settings and include reels, posts or IGTV.'
      : `No saves under ${scopeLabel()} with what is currently included.`;
    $('btn-empty-all').hidden = S.scope.type === 'all';
    open.removeAttribute('href');
    user.textContent = '';
    $('now-date').textContent = '';
    caption.textContent = '';
    caption.disabled = true;
    tags.replaceChildren();
    return;
  }
  open.href = permalink(item);
  user.textContent = item.user ? `@${item.user}` : 'Unknown account';
  user.disabled = !item.user;
  const onlyThem = S.scope.type === 'account' && S.scope.value === item.user;
  user.title = onlyThem ? 'Back to everything' : 'Only this account';
  $('now-date').textContent = item.savedAt ? `Saved ${formatDate(item.savedAt)}` : (item.collections[0] || '');
  const text = tidyCaption(item.caption);
  caption.textContent = text || 'No caption';
  caption.disabled = !text;
  $('btn-fav').setAttribute('aria-pressed', String(S.favs.has(item.code)));
  tags.replaceChildren(...item.tags.filter((tag) => !isNoiseTag(tag)).slice(0, 14).map((tag) =>
    h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(S.scope.type === 'tag' && S.scope.value === tag),
      onClick: () => setScope(S.scope.type === 'tag' && S.scope.value === tag ? ALL : { type: 'tag', value: tag }),
    }, `#${tag}`)));
}

export function initWatch() {
  on('rotation', ({ direction }) => {
    if (direction !== 0) closeCaption();
    render();
  });
  on('library', render);

  $('mode-shuffle').addEventListener('click', () => setMode('shuffle'));
  $('mode-newest').addEventListener('click', () => setMode('newest'));
  $('scope-prev').addEventListener('click', () => cycleScope(-1));
  $('scope-next').addEventListener('click', () => cycleScope(1));
  $('btn-prev').addEventListener('click', () => go(-1));
  $('btn-next').addEventListener('click', () => go(1));
  $('btn-fav').addEventListener('click', toggleFav);
  $('btn-hide').addEventListener('click', hideCurrent);
  $('btn-reshuffle').addEventListener('click', reshuffle);
  $('btn-settings-w').addEventListener('click', openSettings);
  $('btn-empty-all').addEventListener('click', () => setScope(ALL));
  $('now-caption').addEventListener('click', toggleCaption);
  $('now-user').addEventListener('click', () => {
    const item = currentItem();
    if (item && item.user) toggleScopeAccount(item.user);
  });

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      if ($('now').classList.contains('is-open')) closeCaption();
      else closeSettings();
      return;
    }
    if (!visible() || settingsOpen()) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const onButton = /^(BUTTON|A)$/.test(event.target.tagName);
    if (key === 'ArrowDown' || key === 'j' || key === 'PageDown' || (key === ' ' && !onButton)) go(1);
    else if (key === 'ArrowUp' || key === 'k' || key === 'PageUp') go(-1);
    else if (key === '[' || key === 'ArrowLeft') cycleScope(-1);
    else if (key === ']' || key === 'ArrowRight') cycleScope(1);
    else if (key === 'f') toggleFav();
    else if (key === 'h') hideCurrent();
    else if (key === 'r') reshuffle();
    else if (key === 'o') {
      const item = currentItem();
      if (item) window.open(permalink(item), '_blank', 'noopener,noreferrer');
    } else return;
    event.preventDefault();
  });

  // Swipe on anything that is ours (the embed swallows its own touches).
  // Vertical changes reel; horizontal on the topic bar changes topic.
  let touch = null;
  view().addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.target.closest('.scrollable, .w-now.is-open')) {
      touch = null;
      return;
    }
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now(), scope: Boolean(event.target.closest('.w-scope')) };
  }, { passive: true });
  view().addEventListener('touchend', (event) => {
    if (!touch) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touch.x;
    const dy = end.clientY - touch.y;
    const quick = Date.now() - touch.at < 800;
    const onScope = touch.scope;
    touch = null;
    if (!quick) return;
    if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx) * 1.3) go(dy < 0 ? 1 : -1);
    else if (onScope && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) cycleScope(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Wheel / trackpad, one step per gesture.
  let wheelLock = 0;
  view().addEventListener('wheel', (event) => {
    if (event.target.closest('.scrollable, .w-now.is-open')) return;
    const now = Date.now();
    if (Math.abs(event.deltaY) < 24 || now < wheelLock) return;
    wheelLock = now + 650;
    go(event.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);
}

export { render as renderWatch };
