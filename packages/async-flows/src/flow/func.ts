import type { Scope, ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { AbstractFlow, type FlowExecutor, type FlowExecutorContext } from '../flow.ts';

export class FunctionFlow<T, TReturn, TNext> extends AbstractFlow<T, TReturn, TNext> {
  #fn: FlowExecutor<T, TReturn, TNext> | Error;

  constructor(fn: FlowExecutor<T, TReturn, TNext>, scope: Scope) {
    super(scope);
    this.#fn = fn;
  }

  protected override _each(cx: ScopeContext<FlowExecutorContext<T, TNext>>): Awaitable<TReturn> {
    const fn = this.#fn;

    if (typeof fn !== 'function') throw fn;
    return fn(cx);
  }

  override _onCancel(error: Error) {
    this.#fn = error;
  }

  override _inScope(scope: Scope) {
    const fn = this.#fn;
    if (typeof fn !== 'function') return this;
    return new FunctionFlow(fn, scope);
  }
}
