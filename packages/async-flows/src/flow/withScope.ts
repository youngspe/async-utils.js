import { type CancellableOptions, Scope, type ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import type { AsyncControlFlow, ControlFlow } from '#pkg/controlFlow';
import { type FlowExecutorContext, type ToFlow } from '#pkg/flow';

import { Flow } from './flow.ts';

export class FlowWithScope<T, TReturn, TNext> extends Flow<T, TReturn, TNext> {
  #scope;
  #inner;

  constructor(inner: Flow<T, TReturn, TNext>, scope: Scope) {
    super();
    this.#inner = inner;
    this.#scope = scope;
  }

  override async tryEach<B>(
    handler: (cx: ScopeContext<{ value: T }>) => AsyncControlFlow<B, TNext>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    const scope = Scope.from([this.#scope, options?.scope]);
    return this.#inner.tryEach(handler, { ...options, scope });
  }

  override each(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<TNext>,
    options?: CancellableOptions,
  ) {
    const scope = Scope.from([this.#scope, options?.scope]);
    return this.#inner.each(handler, { ...options, scope });
  }

  override iter(options?: CancellableOptions) {
    const scope = Scope.from([this.#scope, options?.scope]);
    return this.#inner.iter({ ...options, scope });
  }

  override values(options?: CancellableOptions) {
    const scope = Scope.from([this.#scope, options?.scope]);
    return this.#inner.values({ ...options, scope });
  }

  override tryTransformEach<U, UNext, B, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => AsyncControlFlow<B, TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Init>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext> {
    return this.#inner.tryTransformEach(fn, init).inScope(this.#scope);
  }

  override transformEach<U, UNext, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => Awaitable<TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => Awaitable<Init>,
  ): Flow<U, TReturn, UNext> {
    return this.#inner.transformEach(fn, init).inScope(this.#scope);
  }
  override chain<U = T, UReturn = TReturn>(
    ...flows: ToFlow<U, UReturn, TNext>[]
  ): Flow<T | U, TReturn | UReturn, TNext>;
  override chain(...rhs: Flow<T, TReturn, TNext>[]): Flow<T, TReturn, TNext> {
    return this.#inner.chain(...rhs).inScope(this.#scope);
  }
  override thenChain(
    ...rhs: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>
  ): Flow<T, TReturn, TNext> {
    return this.#inner.thenChain(...rhs).inScope(this.#scope);
  }
  override buffer(
    this: FlowWithScope<T, TReturn, undefined>,
    size: number,
    scope?: Scope,
  ): Flow<T, TReturn, unknown> {
    return this.#inner.buffer(size, scope ? Scope.from([this.#scope, scope]) : this.#scope);
  }
}
