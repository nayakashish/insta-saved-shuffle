// The start page: where things stand, and every way into the player.

import { S, ALL } from '../state.js';
import { overview, topTagsByTopic, scopeLabel } from '../library.js';
import { topicLabel, UNSORTED } from '../topics.js';
import { setScope, setMode, refresh, currentItem } from '../rotation.js';
import { $, h, fill, num, formatDate } from './dom.js';
import { openSettings } from './settings.js';

const ACCOUNT_LIMIT = 12;
const TAG_LIMIT = 36;

function watch(scope, mode) {
  if (scope) setScope(scope);
  if (mode) setMode(mode);
  location.hash = '#/watch';
}

function tile(label, entry, scope, small) {
  const percent = entry.count ? Math.round((entry.seen / entry.count) * 100) : 0;
  return h('button', { class: 'tile', type: 'button', onClick: () => watch(scope) },
    h('span', { class: 'tile-count' }, num(entry.count)),
    h('span', { class: 'tile-label' }, label),
    small ? h('span', { class: 'tile-small' }, small) : null,
    h('span', { class: 'tile-bar', title: `${entry.seen} of ${entry.count} watched` },
      h('span', { style: `width:${percent}%` })),
  );
}

function section(title, note, ...content) {
  return h('section', { class: 'home-section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'label' }, title), note ? h('p', { class: 'section-note' }, note) : null),
    ...content,
  );
}

function kindToggle(kind, label, count) {
  const input = h('input', { type: 'checkbox' });
  input.checked = S.kinds[kind];
  input.addEventListener('change', () => {
    S.kinds[kind] = input.checked;
    refresh();
    renderHome();
  });
  return h('label', { class: 'check' }, input, h('span', null, label), h('span', { class: 'num' }, num(count)));
}

function renderBrowse(o, query) {
  const q = query.trim().toLowerCase().replace(/^[@#]/, '');
  const accounts = q ? o.accounts.filter((e) => e.key.toLowerCase().includes(q)).slice(0, 30) : o.accounts.slice(0, ACCOUNT_LIMIT);
  const tags = q ? o.tags.filter((e) => e.key.includes(q)).slice(0, 60) : o.tags.slice(0, TAG_LIMIT);
  fill($('browse-accounts'),
    ...accounts.map((e) => h('li', null, h('button', { type: 'button', onClick: () => watch({ type: 'account', value: e.key }) },
      h('span', { class: 'name' }, `@${e.key}`), h('span', { class: 'num' }, num(e.count))))),
    accounts.length === 0 ? h('li', { class: 'none' }, 'No account matches.') : null,
    !q && o.accounts.length > ACCOUNT_LIMIT ? h('li', { class: 'none' }, `${num(o.accounts.length - ACCOUNT_LIMIT)} more accounts. Search to find one.`) : null,
  );
  fill($('browse-tags'),
    ...tags.map((e) => h('button', { class: 'chip', type: 'button', onClick: () => watch({ type: 'tag', value: e.key }) },
      `#${e.key}`, h('span', { class: 'num' }, num(e.count)))),
    tags.length === 0 ? h('p', { class: 'none' }, 'No tag matches.') : null,
  );
}

export function renderHome() {
  const o = overview();
  const topTags = topTagsByTopic();
  const onlyReels = S.kinds.reel && !S.kinds.post && !S.kinds.tv;
  const noun = onlyReels ? (o.total === 1 ? 'reel' : 'reels') : (o.total === 1 ? 'save' : 'saves');
  const item = currentItem();
  const resumable = item && S.seen.size > 0 && S.queue.length > 0;

  const search = h('input', { type: 'search', class: 'field', placeholder: 'Find an account or a tag', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Find an account or a tag' });
  search.addEventListener('input', () => renderBrowse(o, search.value));

  fill($('home-root'),
    h('header', { class: 'masthead' },
      h('span', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }), 'Saved Shuffle'),
      h('nav', null,
        h('a', { class: 'textbtn', href: '#/import' }, 'Import'),
        h('button', { class: 'textbtn', type: 'button', onClick: openSettings }, 'Settings'),
        h('a', { class: 'textbtn', href: '#/privacy' }, 'Privacy'))),

    h('div', { class: 'hero' },
      h('h1', { class: 'display' }, `${num(o.total)} saved ${noun}.`),
      h('p', { class: 'lede' },
        o.total === 0
          ? 'Nothing to play with what is included right now. Tick a kind below.'
          : `${num(o.seen)} watched, ${num(o.total - o.seen)} still to come.${o.latest ? ` Latest save ${formatDate(o.latest)}.` : ''}`),
      S.isDefault
        ? h('p', { class: 'notice' }, 'This list came with this copy of the site. ', h('a', { href: '#/import' }, 'Import your own'), ' to replace it in this browser.')
        : null),

    h('div', { class: 'starts' },
      resumable
        ? h('button', { class: 'start start-primary', type: 'button', onClick: () => watch() },
            h('span', { class: 'start-title' }, 'Continue'),
            h('span', { class: 'start-sub' }, `${scopeLabel()}, ${S.mode === 'newest' ? 'newest first' : 'shuffled'}. ${num(S.pos + 1)} of ${num(S.queue.length)}.`))
        : null,
      h('button', { class: `start${resumable ? '' : ' start-primary'}`, type: 'button', onClick: () => watch(ALL, 'shuffle') },
        h('span', { class: 'start-title' }, 'Shuffle everything'),
        h('span', { class: 'start-sub' }, 'Each one once before anything repeats.')),
      h('button', { class: 'start', type: 'button', onClick: () => watch(ALL, 'newest') },
        h('span', { class: 'start-title' }, 'Newest first'),
        h('span', { class: 'start-sub' }, 'From your latest save backwards.'))),

    h('div', { class: 'include' },
      h('span', { class: 'label' }, 'Include'),
      kindToggle('reel', 'Reels', o.kinds.reel),
      kindToggle('post', 'Posts', o.kinds.post),
      kindToggle('tv', 'IGTV', o.kinds.tv)),

    o.topics.length
      ? section('Topics', 'Sorted on this device from hashtags and captions. A save can sit in more than one.',
          h('div', { class: 'tiles' }, o.topics.map((e) => tile(
            topicLabel(e.key), e, { type: 'topic', value: e.key },
            e.key === UNSORTED ? 'No recognisable subject' : (topTags.get(e.key) || []).map((t) => `#${t}`).join('  ')))))
      : null,

    o.collections.length
      ? section('Collections', 'As you filed them on Instagram.',
          h('div', { class: 'tiles' }, o.collections.map((e) => tile(e.key, e, { type: 'collection', value: e.key }))))
      : null,

    o.starred.count || o.broken
      ? section('Yours', null, h('div', { class: 'tiles' },
          o.starred.count ? tile('Starred', o.starred, { type: 'starred', value: null }, 'The ones you marked here') : null,
          o.broken ? tile('Will not play here', { count: o.broken, seen: 0 }, { type: 'broken', value: null }, 'Open these on Instagram instead') : null))
      : null,

    section('Accounts and tags', null,
      search,
      h('div', { class: 'browse' },
        h('ul', { id: 'browse-accounts', class: 'accounts' }),
        h('div', { id: 'browse-tags', class: 'chips' }))),

    h('footer', { class: 'home-foot' },
      h('p', null, 'Stored in this browser only. Videos play through Instagram\'s own player. ', h('a', { href: '#/privacy' }, 'Privacy notes'), '.')),
  );
  renderBrowse(o, '');
}
