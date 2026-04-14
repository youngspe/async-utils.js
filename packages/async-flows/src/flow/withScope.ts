import { type CancellableOptions, Scope, type ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import type { ControlFlow } from '../controlFlow.ts';
import { Flow } from '../flow.ts';

export class FlowWithScope<T, TReturn, TNext> extends Flow<T, TReturn, TNext> {
  #scope;
  #inner;

  constructor(inner: Flow<T, TReturn, TNext>, scope: Scope) {
    super();
    this.#inner = inner;
    this.#scope = scope;
  }

  override async tryEach<B>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
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
}
