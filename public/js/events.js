// Minimal publish / subscribe so modules do not import each other in circles.
//
//   'rotation'  { direction }  the item on screen (or the queue) changed
//   'library'                  items, flags, kinds or settings changed
//   'toast'     string         a short message for the user

const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
}

export function emit(type, detail) {
  for (const fn of listeners.get(type) || []) fn(detail);
}

export const toast = (message) => emit('toast', message);
