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
  type ScopeContext,
} from '@youngspe/async-scope';
import { ControlFlow } from '../controlFlow.ts';
import {
  FunctionFlow,
  type FlowExecutor,
  FlowFromIter,
  DeferredFlow,
  Flow,
  _asFlow,
  _asAsyncFlow,
} from '../flow.ts';
import { cancellableAsyncIterator } from '../iter.ts';
import { isPromiseLike, type OrNever } from '@youngspe/common-async-utils';
import type { Awaitable } from '@youngspe/async-scope-common';
import type { Falsy } from '../types.ts';

export function toFlow<T, TReturn = void, TNext = void>(
  this: void,
  value: ToFlow<T, TReturn, TNext>,
): Flow<T, TReturn, TNext> {
  if (!value)
    return new ConstantFlow(value) as Flow<T, undefined, unknown> as Flow<T, TReturn & undefined, unknown>;
  if (isPromiseLike(value)) return DeferredFlow.create(value);

  if (value instanceof Flow) return value[_asFlow]?.() ?? value;

  return iterToFlow(value);
}

export function toFlowAsync<T, TReturn = void, TNext = void>(
  this: void,
  value: ToFlow<T, TReturn, TNext>,
): Awaitable<Flow<T, TReturn, TNext>> {
  if (!value)
    return new ConstantFlow(value) as Flow<T, undefined, unknown> as Flow<T, TReturn & undefined, unknown>;
  if (isPromiseLike(value)) return value.then(toFlow<T, TReturn, TNext>, failedFlow);

  if (value instanceof Flow) return value[_asAsyncFlow]?.() ?? value[_asFlow]?.() ?? value;

  return iterToFlow(value);
}

export function iterToFlow<T, TReturn = undefined, TNext = unknown>(
  iterable: MaybeAsyncIterableOrIterator<T, TReturn, TNext>,
  options?: CancellableOptions,
): Flow<T, TReturn, TNext> {
  const scope = Scope.from(options);
  const { error } = scope.token;

  if (error) return new CancelledFlow(error);
  return new FlowFromIter(iterable, scope);
}

export function cancelledFlow(
  this: void,
  error: unknown = new CancellationError(),
): Flow<never, never, unknown> {
  return new CancelledFlow(toErrorForCancellation(error));
}

export function failedFlow(this: void, error: unknown): Flow<never, never, unknown> {
  return new CancelledFlow(error);
}

export function emptyFlow<TReturn>(this: void, value?: TReturn): Flow<never, TReturn, unknown> {
  return new EmptyFlow(value as TReturn);
}
export function flowOf<T>(...values: T[]): Flow<T, undefined, unknown>;
export function flowOf<A extends T[], T = A[number]>(...values: A): Flow<T, undefined, unknown>;
export function flowOf<T>(...values: T[]): Flow<T, undefined, unknown> {
  return iterToFlow(values);
}

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

class EmptyFlow<TReturn> extends Flow<never, TReturn, unknown> {
  #ret;

  constructor(ret: TReturn) {
    super();
    this.#ret = ret;
  }

  override tryEach(_: unknown, options?: CancellableOptions) {
    const { error } = Token.from(options);
    if (error) return Promise.reject(error);
    return Promise.resolve({ continue: this.#ret });
  }

  override each(_: unknown, options?: CancellableOptions) {
    const { error } = Token.from(options);
    if (error) return Promise.reject(error);
    return Promise.resolve(this.#ret);
  }

  override iter(options?: CancellableOptions): AsyncIterableIterator<never, TReturn, unknown> {
    return cancellableAsyncIterator(emptyAsyncIterator(this.#ret), options);
  }

  override values(options?: CancellableOptions): AsyncIterableIterator<never, TReturn, unknown> {
    return this.iter(options);
  }
}

class ConstantFlow<T> extends Flow<T, undefined, unknown> {
  #value: T;

  constructor(value: T) {
    super();
    this.#value = value;
  }

  override readonly repeatable = true;

  override async tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, unknown>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, undefined>> {
    const ret = await ControlFlow.fromAsync(
      handler(Scope.from(options).withContextValues({ value: this.#value }).getContext()),
    );

    if ('continue' in ret) return ControlFlow.CONTINUE;
    return ret;
  }

  override async each(
    handler: (cx: ScopeContext<{ value: T }>) => unknown,
    options?: CancellableOptions,
  ): Promise<undefined> {
    await handler(Scope.from(options).withContextValues({ value: this.#value }).getContext());
  }

  override values(options?: CancellableOptions) {
    return cancellableAsyncIterator([this.#value], options);
  }

  override iter(options?: CancellableOptions) {
    return cancellableAsyncIterator([{ value: this.#value, scope: Scope.static }], options);
  }
}

export type ToFlow<T, TReturn, TNext> = Awaitable<
  | Flow<T, TReturn, TNext>
  | Iterable<T, TReturn, TNext>
  | AsyncIterable<T, TReturn, TNext>
  | OrNever<TReturn & undefined, T & Falsy>
>;
