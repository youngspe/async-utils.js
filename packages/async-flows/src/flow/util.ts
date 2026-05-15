import {
  emptyAsyncIterator,
  throwingAsyncIterator,
  type MaybeAsyncIterableOrIterator,
} from '@youngspe/async-iter-utils';

import {
  CancellationError,
  Scope,
  toErrorForCancellation,
  Token,
  type CancellableOptions,
} from '@youngspe/async-scope';
import { isPromiseLike, type OrNever, NEVER_PROMISE } from '@youngspe/common-async-utils';
import type { Awaitable } from '@youngspe/async-scope-common';

import { cancellableAsyncIterator } from '#pkg/iter';
import type { Falsy } from '#pkg/types';

import {
  _asAsyncFlow,
  _asFlow,
  type FlowExecutor,
  FunctionFlow,
  DeferredFlow,
  FlowFromIter,
} from '#pkg/flow';

import { Flow } from './flow.ts';

/**
 * Converts the given {@link ToFlow} value to a {@link Flow}.
 *
 * @see {@linkcode toFlowAsync()}
 */
export function toFlow<T, TReturn = void, TNext = void>(
  this: void,
  value: ToFlow<T, TReturn, TNext>,
): Flow<T, TReturn, TNext> {
  if (!value) return emptyFlow() as Flow<T, TReturn & undefined, unknown>;
  if (isPromiseLike(value)) return DeferredFlow.create(value);

  if (value instanceof Flow) return value[_asFlow]?.() ?? value;

  return iterToFlow(value);
}

/**
 * Converts the given {@link ToFlow} value to either a {@link Flow} or `Promise<Flow>`.
 *
 * Comparable to {@linkcode toFlow()}, but preferred when `value` may be a promise-like and the
 * result is going to be awaited anyway. This means `Promise<ToFlow>`s don't need to be wrapped in
 * another flow.
 *
 * @see {@linkcode toFlow()}
 */
export function toFlowAsync<T, TReturn = void, TNext = void>(
  this: void,
  value: ToFlow<T, TReturn, TNext>,
): Awaitable<Flow<T, TReturn, TNext>> {
  if (!value) return emptyFlow() as Flow<T, TReturn & undefined, unknown>;
  if (isPromiseLike(value)) return value.then(toFlow<T, TReturn, TNext>, failedFlow);

  if (value instanceof Flow) return value[_asAsyncFlow]?.() ?? value[_asFlow]?.() ?? value;

  return iterToFlow(value);
}

/**
 * Creates a flow from the given synchronous or asynchronous iterable or iterator.
 */
export function iterToFlow<T, TReturn = undefined, TNext = unknown>(
  iterable: MaybeAsyncIterableOrIterator<T, TReturn, TNext>,
  options?: CancellableOptions,
): Flow<T, TReturn, TNext> {
  const scope = Scope.from(options);
  const { error } = scope.token;

  if (error) return new CancelledFlow(error);
  return new FlowFromIter(iterable, scope);
}

/**
 * Creates a flow that throws instead of yielding items when observed.
 * If no argument or a non-Error is passed, uses a {@link CancellationError}.
 */
export function cancelledFlow(
  this: void,
  error: unknown = new CancellationError(),
): Flow<never, never, unknown> {
  return new CancelledFlow(toErrorForCancellation(error));
}

/**
 * Creates a flow that throws instead of yielding items when observed.
 */
export function failedFlow(this: void, error: unknown): Flow<never, never, unknown> {
  return new CancelledFlow(error);
}

/**
 * Creates a flow that yields no items.
 */
export function emptyFlow<TReturn = never, T = never>(this: void): Flow<T, TReturn | undefined, unknown>;
/**
 * @param value - The value returned when the flow is completed.
 */
export function emptyFlow<TReturn = undefined, T = never>(
  this: void,
  value: Awaitable<TReturn>,
): Flow<T, TReturn, unknown>;
export function emptyFlow<TReturn = never, T = never>(
  this: void,
  value?: Awaitable<TReturn>,
): Flow<T, TReturn | undefined, unknown>;
export function emptyFlow<TReturn = never, T = never>(
  this: void,
  value?: Awaitable<TReturn>,
): Flow<T, TReturn | undefined, unknown> {
  return new EmptyFlow(value);
}

/** @deprecated use {@link emptyFlow()} */
export function flowOf<T = never>(): Flow<T, undefined, unknown>;
/** Creates a flow that immediately yields the given items. */
export function flowOf<T>(...values: T[]): Flow<T, undefined, unknown>;
export function flowOf<A extends T[], T = A[number]>(...values: A): Flow<T, undefined, unknown>;
export function flowOf<T>(...values: T[]): Flow<T, undefined, unknown> {
  return iterToFlow(values);
}

/** Creates a flow that yields exactly one item. */
export function just<T>(value: T): Flow<T, undefined, unknown> {
  return flowOf(value);
}

/** Creates a flow that never yields or completes. */
export const neverFlow = <T = never, TReturn = never, TNext = unknown>(): Flow<T, TReturn, TNext> =>
  new NeverFlow();

/**
 * Creates a flow defined by the given executor function.
 *
 * The executor function is called each time the flow is observed.
 * The {@linkcode FlowExecutorContext#emit|emit}, {@linkcode FlowExecutorContext#emit|emitScoped},
 * and {@linkcode FlowExecutorContext#emit|emitAll} functions passed to the executor supply the
 * values yielded to the flow handler.
 *
 * @example
 * import { defineFlow } from '@youngspe/async-flows';
 *
 * const flow = defineFlow<number, string>(async ({ scope, emit }) => {
 *   await emit(1);
 *   await scope.delay(1000);
 *
 *   await emit(2);
 *   await scope.delay(1000);
 *
 *   await emit(3);
 *   await scope.delay(1000);
 *
 *   return 'hello';
 * });
 *
 * const out = await flow.each(({ value }) => {
 *   console.log(value);
 * });
 *
 * console.log(out);
 *
 * // Output:
 * // 1
 * // 2
 * // 3
 * // hello
 */
export function defineFlow<T, TReturn = undefined, TNext = unknown>(
  fn: FlowExecutor<T, TReturn, TNext>,
  options?: CancellableOptions,
): Flow<T, TReturn, TNext> {
  const scope = Scope.from(options);
  const { error } = scope.token;

  if (error) return cancelledFlow(error);

  return new FunctionFlow(fn, scope);
}

class CancelledFlow extends Flow<never, never, unknown> {
  #error;

  constructor(error: unknown) {
    super();
    this.#error = error;
  }

  override tryEach() {
    return Promise.reject(this.#error);
  }

  override each() {
    return Promise.reject(this.#error);
  }

  override iter(): AsyncIterableIterator<never, never, unknown> {
    return throwingAsyncIterator(this.#error);
  }

  override values(): AsyncIterableIterator<never, never, unknown> {
    return throwingAsyncIterator(this.#error);
  }
}

const NEVER_ITER: AsyncIterableIterator<never, never, unknown> = Object.freeze({
  next: () => NEVER_PROMISE,
  [Symbol.asyncIterator]() {
    return this;
  },
});

class NeverFlow extends Flow<never, never, unknown> {
  override tryEach() {
    return NEVER_PROMISE;
  }

  override each() {
    return NEVER_PROMISE;
  }

  override iter() {
    return NEVER_ITER;
  }

  override values() {
    return NEVER_ITER;
  }
}

class EmptyFlow<TReturn> extends Flow<never, TReturn, unknown> {
  #ret;
  #initialized;

  constructor(ret: Awaitable<TReturn>) {
    super();
    this.#ret = ret;
    this.#initialized = !isPromiseLike(ret);
  }

  override async tryEach(_: unknown, options?: CancellableOptions) {
    const { error } = Token.from(options);
    if (error) return Promise.reject(error);
    let ret = this.#ret;

    if (isPromiseLike(ret)) {
      if (!this.#initialized) {
        ret = ret.then(value => {
          this.#ret = value;
          return value;
        });
        this.#initialized = true;
      }
      if (!options) return { continue: await ret };

      const scope = Scope.from(options);
      return { continue: await scope.resolveOrCancel(ret) };
    }

    return { continue: ret };
  }

  override each(_: unknown, options?: CancellableOptions) {
    const { error } = Token.from(options);
    if (error) return Promise.reject(error);

    let ret = this.#ret;

    if (isPromiseLike(ret)) {
      if (!this.#initialized) {
        ret = ret.then(value => {
          this.#ret = value;
          return value;
        });
        this.#initialized = true;
      }
      if (!options) return Promise.resolve(ret);

      const scope = Scope.from(options);
      return scope.resolveOrCancel(ret);
    }

    return Promise.resolve(ret);
  }

  override iter(options?: CancellableOptions): AsyncIterableIterator<never, TReturn, unknown> {
    return cancellableAsyncIterator(emptyAsyncIterator(this.#ret), options);
  }

  override values(options?: CancellableOptions): AsyncIterableIterator<never, TReturn, unknown> {
    return this.iter(options);
  }
}

/** A {@link Flow} or a value that can be converted to a Flow using {@linkcode toFlow()}. */
export type ToFlow<T, TReturn, TNext> = Awaitable<
  | Flow<T, TReturn, TNext>
  | Iterable<Awaitable<T>, Awaitable<TReturn>, TNext>
  | AsyncIterable<T, TReturn, TNext>
  | OrNever<TReturn & undefined, Falsy>
>;
