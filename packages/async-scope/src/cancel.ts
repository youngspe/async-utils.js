import { CancellationError } from './error.ts';
import { Subscription } from './events/sub.js';
import type { ToScope } from './scope.ts';
import type * as Symbols from './symbols.ts';
import type { Awaitable, Falsy } from './types.ts';
import { isArray, whenAllSettled } from '@youngspe/common-async-utils';

export interface CancellableParent {}

export interface Cancellable {
  cancel(reason: Error): Awaitable<void>;
  /** Return false to prevent the parent from adding this cancellable. */
  [Symbols.cancellableAdded]?(key: CancellableParent, sub: Subscription): boolean | void;
  [Symbols.cancellableRemoved]?(key: CancellableParent): void;
}

export type CancellableLike<Extra = never> =
  | Cancellable
  | Falsy
  | Disposable
  | AsyncDisposable
  | readonly CancellableLike<Extra>[]
  | Extra;

export type CancellationListener = (reason: Error) => Awaitable<void>;

export async function cancelObject(target: CancellableOrDisposable, reason: Error) {
  if (typeof target.cancel === 'function') {
    await target.cancel(reason);
    return;
  }

  if (typeof target[Symbol.asyncDispose] === 'function') {
    await target[Symbol.asyncDispose]!();
    return;
  }

  if (typeof target[Symbol.dispose] === 'function') {
    target[Symbol.dispose]!();
    return;
  }
}

export function cancel(target: CancellableLike, reason?: Error): Promise<void>;
export function cancel(target: CancellableLike, reason: Error = new CancellationError()): Promise<void> {
  if (!target) return Promise.resolve();

  if (isArray(target)) {
    return whenAllSettled(target, t => cancel(t, reason));
  }

  return cancelObject(target, reason);
}

export interface CancellableOrDisposable
  extends Partial<Cancellable>, Partial<Disposable>, Partial<AsyncDisposable> {}

export interface CancellableOptions {
  scope?: ToScope;
  token?: ToScope;
  signal?: AbortSignal | undefined;
}
