import { CancellationError } from './error.ts';
import { Subscription } from './events/sub.js';
import type { ToScope } from './scope.ts';
import type * as Symbols from './symbols.ts';
import type { AddCancellableOptions } from './token.ts';
import type { Awaitable, Falsy } from './types.ts';
import { isArray, isPromiseLike, whenAllSettled } from '@youngspe/common-async-utils';

/**
 * A unique key for some cancellation source (e.g. a {@link Token}).
 *
 * This is provided when adding or removing a {@link Cancellable}.
 */
export interface CancellableParent {
  get error(): Error | undefined;
  add(
    listener: CancellableLike<CancellationListener>,
    options?: AddCancellableOptions,
  ): Subscription | undefined;
}

/**
 * A cancellation listener.
 * This may be notified when some operation has ended or some resource is no longer available.
 */
export interface Cancellable {
  /**
   * Notifies the listener of cancellation.
   */
  cancel(reason: Error): Awaitable<void>;
  /**
   * Notifies the listener of cancellation, preferring to complete synchronously if possible.
   */
  tryCancelSync?(reason: Error): Awaitable<void>;
  /**
   * Called before adding the cancellable to some cancellation source.
   *
   * @returns
   * - `true` or `undefined` if the cancellable should be added.
   * - `false` if the cancellable should not be added.
   * - {@link Subscription} if the cancellable should not be added and an alternative subscription
   *   handle should be returned.
   */
  [Symbols.cancellableAdding]?(
    key?: CancellableParent,
    options?: AddCancellableOptions,
  ): boolean | Subscription | void;
  /**
   * Called after adding the cancellable to some cancellation source.
   *
   * @returns
   * - `true` or `undefined` if the cancellable should be added.
   * - `false` if the cancellable should be removed
   * - {@link Subscription} if an alternative subscription handle should
   *   be returned.
   */
  [Symbols.cancellableAdded]?(
    key: CancellableParent,
    sub: Subscription,
    options?: AddCancellableOptions,
  ): boolean | Subscription | void;
  /**
   * Called after removing the cancellable from some cancellation source.
   */
  [Symbols.cancellableRemoved]?(key: CancellableParent): void;
}

/**
 * A value that can be converted to a {@link Cancellable} or `Extra`.
 */
export type CancellableLike<Extra = never> =
  | Cancellable
  | Falsy
  | Disposable
  | AsyncDisposable
  | readonly CancellableLike<Extra>[]
  | Extra;

/**
 * A function that can be used in place of a {@link Cancellable}.
 */
export type CancellationListener = (reason: Error) => Awaitable<void>;

/**
 * Cancels the given cancellable object, returning a non-promise if the cancellation completed
 * synchronously.
 */
export function tryCancelObjectSync(
  target: CancellableOrDisposable,
  reason: Error,
): undefined | PromiseLike<void> {
  let p: Awaitable<void> = undefined;

  if (typeof target.tryCancelSync === 'function') {
    p = target.tryCancelSync(reason);
  } else if (typeof target.cancel === 'function') {
    p = target.cancel(reason);
  } else if (typeof target[Symbol.dispose] === 'function') {
    p = target[Symbol.dispose]!();
  } else if (typeof target[Symbol.asyncDispose] === 'function') {
    p = target[Symbol.asyncDispose]!();
  }

  return isPromiseLike(p) ? p : undefined;
}

/**
 * Notifies the given cancellable object, returning a promise that resolves when the cancellation
 * is complete or `undefined` if the cancellation completed synchronously.
 */
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

/**
 * Notifies the given cancellable object, returning a promise that resolves when the cancellation
 * is complete.
 */
export function cancel(target: CancellableLike, reason: Error = new CancellationError()): Promise<void> {
  if (!target) return Promise.resolve();

  if (isArray(target)) {
    return whenAllSettled(target, t => cancel(t, reason));
  }

  return cancelObject(target, reason);
}

/** An object that may have the methods of a {@link Cancellable}, {@link Disposable}, or {@link AsyncDisposable} */
export interface CancellableOrDisposableObject
  extends Partial<Cancellable>, Partial<Disposable>, Partial<AsyncDisposable> {}

/** An with the methods of at least one of {@link Cancellable}, {@link Disposable}, or {@link AsyncDisposable} */
export type CancellableOrDisposable = CancellableOrDisposableObject
  & (Cancellable | Disposable | AsyncDisposable);

/**
 * Options for a cancellable operation.
 * This may include a {@link Scope}, a {@link Token}, or an {@link AbortSignal}.
 */
export interface CancellableOptions {
  /** A scope-like value to signal when an operation ends. */
  scope?: ToScope;
  /**
   * A scope-like value to signal when an operation ends.
   * When constructing a {@link Scope}, anything besides the {@link Token} is stripped out.
   */
  token?: ToScope;
  /** An {@link AbortSignal} that signals when an operation ends. */
  signal?: AbortSignal | undefined;
}
