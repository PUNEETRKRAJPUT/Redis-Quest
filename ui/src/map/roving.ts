import { useRef, useState, type KeyboardEvent } from 'react';

/**
 * One tab stop for a group of items; arrow keys, Home and End move focus between them. Items carry `data-rove`.
 * Returns the container ref, the key handler and a function giving each item its tabIndex and focus handler.
 */
export function useRoving<T extends HTMLElement>(count: number, start = 0) {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(Math.min(Math.max(start, 0), Math.max(count - 1, 0)));
  const at = Math.min(active, Math.max(count - 1, 0));
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: count - 1,
    };
    if (!(e.key in keys) || count === 0) return;
    e.preventDefault();
    const items = ref.current?.querySelectorAll<HTMLElement>('[data-rove]');
    if (!items?.length) return;
    const n = (keys[e.key]! + items.length) % items.length;
    setActive(n);
    items[n]!.focus();
  };
  const item = (i: number) => ({
    'data-rove': '',
    tabIndex: i === at ? 0 : -1,
    onFocus: () => setActive(i),
  });
  return { ref, onKeyDown, item };
}
