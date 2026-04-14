import type { CancellableOptions, Scope, ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import type { ControlFlow } from '../controlFlow.ts';
import {
  _asAsyncFlow,
  _asFlow,
  failedFlow,
  Flow,
  toFlow,
  type FlowExecutorContext,
  type ToFlow,
} from '../flow.ts';

export class DeferredFlow<T, TReturn, TNext> extends Flow<T, TReturn, TNext> {
  #promise: Promise<Flow<T, TReturn, TNext>>;
  #inner: Flow<T, TReturn, TNext> | undefined;

  override [_asFlow]() {
    return this.#inner;
  }

  override [_asAsyncFlow]() {
    return this.#inner ?? this.#promise;
  }

  constructor(promise: Promise<Flow<T, TReturn, TNext>>) {
    super();
    this.#promise = promise.then(f => {
      this.#inner = f;
      if (f.repeatable) {
        this.repeatable = true;
      }

      return f;
    });
  }

  static create<T, TReturn, TNext>(
    this: void,
    promise: PromiseLike<ToFlow<T, TReturn, TNext>>,
  ): DeferredFlow<T, TReturn, TNext> {
    return new DeferredFlow(Promise.resolve(promise.then(toFlow, failedFlow)));
  }

  override tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    if (this.#inner) return this.#inner.tryEach(handler, options);
    return this.#promise.then(f => f.tryEach(handler, options));
  }

  override async each(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<TNext>,
    options?: CancellableOptions,
  ): Promise<TReturn> {
    if (this.#inner) return this.#inner.each(handler, options);
    return this.#promise.then(f => f.each(handler, options));
  }

  override tryEachValue<B = never>(
    handler: (value: T) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    if (this.#inner) return this.#inner.tryEachValue(handler, options);
    return this.#promise.then(f => f.tryEachValue(handler, options));
  }

  override async eachValue(
    handler: (value: T) => Awaitable<TNext>,
    options?: CancellableOptions,
  ): Promise<TReturn> {
    if (this.#inner) return this.#inner.eachValue(handler, options);
    return this.#promise.then(f => f.eachValue(handler, options));
  }

  override iter(
    options?: CancellableOptions,
  ): AsyncIterableIterator<{ value: T; scope: Scope }, TReturn, TNext> {
    if (this.#inner) return this.#inner.iter(options);
    return (async function* (promise) {
      return yield* (await promise).iter();
    })(this.#promise);
  }

  override values(options?: CancellableOptions): AsyncIterableIterator<T, TReturn, TNext> {
    if (this.#inner) return this.#inner.values(options);
    return (async function* (promise) {
      return yield* (await promise).values();
    })(this.#promise);
  }

  override tryTransformEach<U, UNext, B>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    ) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
  ) {
    if (this.#inner) return this.#inner.tryTransformEach(fn);
    return new DeferredFlow(this.#promise.then(f => f.tryTransformEach(fn)));
  }

  override transformEach<U, UNext>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>) => Awaitable<TNext>,
  ) {
    if (this.#inner) return this.#inner.transformEach(fn);
    return new DeferredFlow(this.#promise.then(f => f.transformEach(fn)));
  }

  override chain(...rhs: Flow<T, TReturn, TNext>[]) {
    if (this.#inner) return this.#inner.chain(...rhs);
    return new DeferredFlow(this.#promise.then(f => f.chain(...rhs)));
  }

  override thenChain(...rhs: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>) {
    if (this.#inner) return this.#inner.thenChain(...rhs);
    return new DeferredFlow(this.#promise.then(f => f.thenChain(...rhs)));
  }
}
