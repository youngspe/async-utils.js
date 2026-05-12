import type { Awaitable } from './types.ts';

export function nestedMicrotask<Args extends readonly unknown[] = []>(
  n: number,
  callback: (...args: [...Args]) => void,
  ...args: Args
): void {
  if (n > 0) {
    const inner = () => {
      if (n === 0) {
        callback(...args);
        return;
      }

      --n;

      queueMicrotask(inner);
    };
    inner();
    return;
  }
  callback(...args);
  return;
}

export function microtaskRepeat<Args extends readonly unknown[] = []>(
  maxN: number,
  callback: (n: number, ...args: [...Args]) => boolean,
  ...args: Args
): void {
  const inner = (i: number) => {
    if (!(i <= maxN)) return;
    queueMicrotask(() => {
      if (callback(i, ...args)) {
        inner(i + 1);
      }
    });
  };

  inner(1);
}

export function awaitNestedMicrotask<T = void>(n: number, value: Awaitable<T>): Promise<T> {
  return n > 0 ? new Promise(resolve => nestedMicrotask(n, resolve, value)) : Promise.resolve(value);
}
