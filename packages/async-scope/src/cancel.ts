import { CancellationError } from './error.ts';
import type Symbols from './symbols.ts';
import type { Awaitable, Falsy } from './types.ts';
import { isArray, joinPromisesAggregatingErrors } from './utils.ts';

export interface CancellableParentHandle {
  remove(key: object): void;
  isValid(key: object): boolean;
}

export interface Cancellable {
  cancel(reason: Error): Awaitable<void>;
  /** Return false to prevent the parent from adding this cancellable. */
  [Symbols.cancellableAdded]?(handle: CancellableParentHandle): boolean | void;
  [Symbols.cancellableRemoved]?(handle: CancellableParentHandle): void;
}

export type CancellableLike =
  | Cancellable
  | Falsy
  | Disposable
  | AsyncDisposable
  | readonly CancellableLike[];

export type CancellationListener = (reason: unknown) => Awaitable<void>;

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
export async function cancel(
  target: CancellableLike,
  reason: Error = new CancellationError(),
): Promise<void> {
  if (!target) return;

  if (isArray(target)) {
    await joinPromisesAggregatingErrors(target.map(t => cancel(t, reason)));
    return;
  }

  return cancelObject(target, reason);
}

export interface CancellableOrDisposable
  extends Partial<Cancellable>, Partial<Disposable>, Partial<AsyncDisposable> {}
