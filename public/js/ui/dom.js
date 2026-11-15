// Small DOM helpers. Text always goes in through textContent, never innerHTML.

export const $ = (id) => document.getElementById(id);

// h('button', { class: 'btn', onClick: fn }, 'Label')
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

// replaceChildren that ignores null / false, so optional parts can be
// written inline as `condition ? node : null`.
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((child) => child != null && child !== false));
}

// A caption for reading: drop the "." spacer lines and the trailing block of
// hashtags (those are shown as chips), keep everything else as written.
export function tidyCaption(caption) {
  const lines = String(caption || '').split('\n').filter((line) => !/^[\s.·•_\-–—*~]*$/.test(line) || line.trim() === '');
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const stripped = text.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  if (stripped) text = stripped;
  return text;
}

export const num = (value) => Number(value).toLocaleString();

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDate = (timestamp) => dateFormat.format(timestamp);
