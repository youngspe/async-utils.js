import { Scope, type CancellableOptions, type ScopeContext, type ToScope } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { ControlFlow, type AsyncControlFlow } from '#pkg/controlFlow';

import { Flow } from './flow.ts';
import { toFlow, type ToFlow } from './util.ts';
import type { FlowExecutorContext } from './abstract.ts';

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
    handler: (cx: ScopeContext<{ value: T }>) => AsyncControlFlow<B, TNext>,
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
    handler: (value: T) => AsyncControlFlow<B, TNext>,
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

  override tryTransformEach<U, UNext, B, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => AsyncControlFlow<B, TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Init>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext> {
    return new ChainFlow(
      this.#first.tryTransformEach(fn, init),
      this.#rest.map(
        fl => out =>
          'continue' in out ?
            ControlFlow.map(
              fl(out.continue),
              f => toFlow(f).tryTransformEach(fn, init),
              ControlFlow.Continue,
            )
          : { break: out },
      ),
    );
  }

  override transformEach<U, UNext, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => Awaitable<TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => Awaitable<Init>,
  ): Flow<U, TReturn, UNext> {
    return new ChainFlow(
      this.#first.transformEach(fn, init),
      this.#rest.map(fl => out => ControlFlow.map(fl(out), f => toFlow(f).transformEach(fn, init))),
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

  override chain<U = T, UReturn = TReturn>(
    ...flows: ToFlow<U, UReturn, TNext>[]
  ): Flow<T | U, TReturn | UReturn, TNext>;
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
