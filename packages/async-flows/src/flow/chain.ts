import { Scope, type CancellableOptions, type ScopeContext, type ToScope } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { ControlFlow } from '../controlFlow.ts';
import { Flow, toFlow, type FlowExecutorContext, type ToFlow } from '../flow.ts';

export class ChainFlow<T, TReturn, TNext> extends Flow<T, TReturn, TNext> {
  #first: Flow<T, TReturn, TNext>;
  #rest: Array<(value: TReturn) => ControlFlow<TReturn, ToFlow<T, TReturn, TNext>>>;
  constructor(
    first: Flow<T, TReturn, TNext>,
    rest: Array<(value: TReturn) => ControlFlow<TReturn, ToFlow<T, TReturn, TNext>>>,
  ) {
    super();
    this.#first = first;
    this.#rest = rest;
  }

  override async tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    let out = await this.#first.tryEach(handler, options);

    for (const fn of this.#rest) {
      if (!('continue' in out)) return out;

      const flow = fn(out.continue);
      if (!('continue' in flow)) return { continue: flow.break };

      out = await toFlow(flow.continue).tryEach(handler, options);
    }

    return out;
  }

  override async each(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<TNext>,
    options?: CancellableOptions,
  ): Promise<TReturn> {
    let out = await this.#first.each(handler, options);

    for (const fn of this.#rest) {
      const flow = fn(out);
      if (!('continue' in flow)) return flow.break;

      out = await toFlow(flow.continue).each(handler, options);
    }

    return out;
  }

  override async tryEachValue<B = never>(
    handler: (value: T) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    let out = await this.#first.tryEachValue(handler, options);

    for (const fn of this.#rest) {
      if (!('continue' in out)) return out;

      const flow = fn(out.continue);
      if (!('continue' in flow)) return { continue: flow.break };

      out = await toFlow(flow.continue).tryEachValue(handler, options);
    }

    return out;
  }

  override async eachValue(
    handler: (value: T) => Awaitable<TNext>,
    options?: CancellableOptions,
  ): Promise<TReturn> {
    let out = await this.#first.eachValue(handler, options);

    for (const fn of this.#rest) {
      const flow = fn(out);
      if (!('continue' in flow)) return flow.break;

      out = await toFlow(flow.continue).eachValue(handler, options);
    }

    return out;
  }

  override async *iter(
    options?: CancellableOptions,
  ): AsyncIterableIterator<{ value: T; scope: Scope }, TReturn, TNext> {
    let out = yield* this.#first.iter(options);

    for (const fn of this.#rest) {
      const flow = fn(out);
      if (!('continue' in flow)) return flow.break;

      out = yield* toFlow(flow.continue).iter(options);
    }

    return out;
  }

  override async *values(options?: CancellableOptions): AsyncIterableIterator<T, TReturn, TNext> {
    let out = yield* this.#first.values(options);

    for (const fn of this.#rest) {
      const flow = fn(out);
      if (!('continue' in flow)) return flow.break;

      out = yield* toFlow(flow.continue).values(options);
    }

    return out;
  }

  override tryTransformEach<U, UNext, B>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    ) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext> {
    return new ChainFlow(
      this.#first.tryTransformEach(fn),
      this.#rest.map(
        fl => out =>
          'continue' in out ?
            ControlFlow.map(fl(out.continue), f => toFlow(f).tryTransformEach(fn), ControlFlow.Continue)
          : { break: out },
      ),
    );
  }

  override transformEach<U, UNext>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>) => Awaitable<TNext>,
  ): Flow<U, TReturn, UNext> {
    return new ChainFlow(
      this.#first.transformEach(fn),
      this.#rest.map(fl => out => ControlFlow.map(fl(out), f => toFlow(f).transformEach(fn))),
    );
  }

  override inScope(scope: ToScope): Flow<T, TReturn, TNext> {
    const newScope = Scope.from(scope);
    if (scope === Scope.static) return this;

    return new ChainFlow(
      this.#first.inScope(newScope),
      this.#rest.map(fl => out => ControlFlow.map(fl(out), f => toFlow(f).inScope(newScope))),
    );
  }

  override chain(...flows: ToFlow<T, TReturn, TNext>[]): Flow<T, TReturn, TNext> {
    return new ChainFlow(this.#first, this.#rest.concat(flows.map(flow => () => ({ continue: flow }))));
  }

  override thenChain(
    ...flows: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>
  ): Flow<T, TReturn, TNext> {
    return new ChainFlow(
      this.#first,
      this.#rest.concat(flows.map(fl => value => ({ continue: fl(value) }))),
    );
  }
}
