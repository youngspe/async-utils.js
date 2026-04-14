import type { CancellableOptions } from './cancel.ts';
import { Token } from './token.ts';

declare const _timerId: unique symbol;

interface _TimerId {
  [_timerId]: typeof _timerId;
}

type TimerId = typeof globalThis extends { setTimeout(...args: any): infer X } ? X : _TimerId;

type SetTimerFunction = <A extends any[] = []>(
  action: (...args: A) => void,
  ms: number,
  ...args: A
) => TimerId;

type ClearTimerFunction = (id: TimerId | undefined) => void;

export interface Clock {
  setTimeout: SetTimerFunction;
  setInterval: SetTimerFunction;
  clearTimeout: ClearTimerFunction;
  clearInterval: ClearTimerFunction;
}

export const GlobalClock: Clock = {
  setTimeout: (f, ...args) => globalThis.setTimeout(f, ...args),
  setInterval: (f, ...args) => globalThis.setInterval(f, ...args),
  clearTimeout: id => globalThis.clearTimeout(id),
  clearInterval: id => globalThis.clearInterval(id),
};

export interface TimerOptions extends CancellableOptions {
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
