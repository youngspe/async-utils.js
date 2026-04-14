/**
 * A value that yields `T` when awaited. Useful for functions that take either the value itself or a
 * promise that yields it.
 *
 * @template T The type of the value returned by `value` when awaited.
 *
 * @example
 * function asyncMultiply(lhs: Awaitable<number>, rhs: Awaitable<number>) {
 *   const [l, r] = await Promise.all([lhs, rhs]);
 *   return l * r;
 * }
 *
 */
export type Awaitable<T> = T | Promise<T> | PromiseLike<T>;

export abstract class ScopeBase {
  abstract get token(): CancellationTokenBase;
}

export interface CancellableBase {
  cancel(reason: Error): Awaitable<void>;
}

export abstract class CancellationTokenBase {
  /**
   * The reason for the cancellation if this token has already been cancelled, otherwise `undefined`.
   *
   * @see {@link isCancelled}
   */
  abstract get error(): Error | undefined;

  /**
   * If `true`, this token has been _cancelled_, and trigger any additional listeners.
   *
   * This is equivalent to `token.error !== undefined`
   *
   * @see {@link error}
   */
  abstract get isCancelled(): boolean;

  /** If `true`, this token has been _defused_, meaning it is guaranteed never to be cancelled. */
  abstract get isDefused(): boolean;

  /** Adds a listener. */
  abstract add(
    listener: ((error: Error) => Awaitable<void>) | CancellableBase | AsyncDisposable | Disposable,
  ): SubscriptionLike | undefined;
}

export interface SubscriptionLike extends Disposable {
  readonly isActive?: boolean | undefined;
}
