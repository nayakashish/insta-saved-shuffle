import { on } from '../events.js';
import { $ } from './dom.js';

let timer = null;

export function initToast() {
  on('toast', (message) => {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-on'), 2600);
  });
}
