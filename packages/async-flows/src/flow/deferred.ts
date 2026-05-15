import type { CancellableOptions, Scope, ScopeContext, ToScope } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import type { AsyncControlFlow, ControlFlow } from '#pkg/controlFlow';

import { type FlowExecutorContext, type StateFlow, type ToFlow, failedFlow, toFlow } from '#pkg/flow';

import { _asAsyncFlow, _asFlow, Flow } from './flow.ts';

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
    handler: (cx: ScopeContext<{ value: T }>) => AsyncControlFlow<B, TNext>,
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
    handler: (value: T) => AsyncControlFlow<B, TNext>,
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

  override tryTransformEach<U, UNext, B, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => AsyncControlFlow<B, TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Init>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext> {
    if (this.#inner) return this.#inner.tryTransformEach(fn, init);
    return new DeferredFlow(this.#promise.then(f => f.tryTransformEach(fn, init)));
  }

  override transformEach<U, UNext, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => Awaitable<TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => Awaitable<Init>,
  ): Flow<U, TReturn, UNext> {
    if (this.#inner) return this.#inner.transformEach(fn, init);
    return new DeferredFlow(this.#promise.then(f => f.transformEach(fn, init)));
  }
  override chain<U = T, UReturn = TReturn>(
    ...flows: ToFlow<U, UReturn, TNext>[]
  ): Flow<T | U, TReturn | UReturn, TNext>;
  override chain(...rhs: Flow<T, TReturn, TNext>[]): Flow<T, TReturn, TNext> {
    if (this.#inner) return this.#inner.chain(...rhs);
    return new DeferredFlow(this.#promise.then(f => f.chain(...rhs)));
  }

  override thenChain(
    ...rhs: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>
  ): Flow<T, TReturn, TNext> {
    if (this.#inner) return this.#inner.thenChain(...rhs);
    return new DeferredFlow(this.#promise.then(f => f.thenChain(...rhs)));
  }

  override inScope(scope: ToScope): Flow<T, TReturn, TNext> {
    if (this.#inner) return this.#inner.inScope(scope);
    return new DeferredFlow(this.#promise.then(f => f.inScope(scope)));
  }
  override state(
    this: DeferredFlow<T, TReturn, undefined>,
    options: CancellableOptions & { scope: ToScope },
  ): StateFlow<T> {
    if (this.#inner) return this.#inner.state(options);
    return super.state(options);
  }

  override mapScoped<U, UNext = TNext, UReturn = TReturn>(
    fn?: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
    inputFn?: (cx: ScopeContext<{ value: UNext }>) => Awaitable<TNext>,
    returnFn?: (value: ScopeContext<{ value: TReturn }>) => Awaitable<UReturn>,
  ): Flow<U, UReturn, UNext> {
    if (this.#inner) return this.#inner.mapScoped(fn, inputFn, returnFn);
    return new DeferredFlow(this.#promise.then(f => f.mapScoped(fn, inputFn, returnFn)));
  }

  override buffer(
    this: DeferredFlow<T, TReturn, undefined>,
    size: number,
    scope?: Scope,
  ): Flow<T, TReturn, unknown> {
    if (this.#inner) return this.#inner.buffer(size, scope);
    return new DeferredFlow(this.#promise.then(f => f.buffer(size, scope)));
  }
}
