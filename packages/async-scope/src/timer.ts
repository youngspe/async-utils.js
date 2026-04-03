import type { CancellableOptions } from './cancel.ts';
import { Token } from './token.ts';

interface Clock {
  setTimeout: typeof globalThis.setTimeout;
  setInterval: typeof globalThis.setInterval;
  clearTimeout: typeof globalThis.clearTimeout;
  clearInterval: typeof globalThis.clearInterval;
}

const GlobalClock: Clock = {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  setTimeout: (f, ...args) => globalThis.setTimeout(f, ...args),
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  setInterval: (f, ...args) => globalThis.setInterval(f, ...args),
  clearTimeout: id => globalThis.clearTimeout(id),
  clearInterval: id => globalThis.clearInterval(id),
};

interface TimerOptions extends CancellableOptions {
  clock?: Clock | undefined;
}

export function delay(ms: number, options?: TimerOptions): Promise<void> {
  const token = Token.from(options);

  if (token.isCancelled) return Promise.reject(token.error);

  const { setTimeout, clearTimeout } = options?.clock ?? GlobalClock;

  if (token.isDefused) return new Promise(resolve => setTimeout(resolve, ms));

  return new Promise((resolve, reject) => {
    const sub = token.add(e => {
      clearTimeout(id);
      reject(e);
    });

    const id = setTimeout(() => {
      sub?.dispose();
      resolve();
    }, ms);
  });
}
