import { channel, mapAsyncIterator } from '@youngspe/async-iter-utils';

import {
  Scope,
  Token,
  type CancellableOptions,
  type ScopeContext,
  type ToScope,
} from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { ControlFlow, type AsyncControlFlow } from '#pkg/controlFlow';
import { pipeThis } from '#pkg/flow/ops/module';

import {
  BufferedFlow,
  cancelledFlow,
  ChainFlow,
  defineFlow,
  FlowError,
  FlowWithScope,
  ScopedMapFlow,
  StateFlow,
  type FlowExecutorContext,
  type ToFlow,
} from '#pkg/flow';

declare const _itemMarker: unique symbol;
declare const _retMarker: unique symbol;

export type FlowItemOf<F extends ToFlow<unknown, unknown, never>> =
  F extends Flow<any, any, never> ? NonNullable<F[typeof _itemMarker]>['value']
  : F extends ToFlow<infer T, any, never> ? T
  : F;
export type FlowReturnOf<F extends ToFlow<unknown, unknown, never>> =
  F extends Flow<any, any, never> ? NonNullable<F[typeof _retMarker]>['value']
  : F extends ToFlow<any, infer TReturn, never> ? TReturn
  : undefined;

export const _asFlow = Symbol('_asFlow');
export const _asAsyncFlow = Symbol('_asAsyncFlow');

export abstract class Flow<out T, out TReturn = unknown, in TNext = void> {
  /**
   * Hint for the item type of a flow
   * @ignore
   */
  declare [_itemMarker]?: { value: T };
  /**
   * Hint for the return type of a flow
   * @ignore
   */
  declare [_retMarker]?: { value: TReturn };

  /**
   * Observes the flow by calling the given handler function for each item.
   * The handler receives a {@link ScopeContext} with a `value` property for the current value.
   * The handler may return {@linkcode ControlFlow.Continue|Continue<TNext>} to continue observing or
   * {@linkcode ControlFlow.Break|Break<B>} to return early.
   *
   * Resolves to {@linkcode ControlFlow.Break|Break<B>} when the handler requests to return early;
   * otherwise resolves to {@linkcode ControlFlow.Continue|Continue<TReturn>} when the flow
   * is completed.
   *
   * @see {@linkcode Flow#each}
   * @see {@linkcode Flow#tryEachValue}
   */
  abstract tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => AsyncControlFlow<B, TNext>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>>;

  /**
   * Provide a value to return from `toFlow(this)` instead of `this`
   * @ignore
   */
  [_asFlow]?(): Flow<T, TReturn, TNext> | undefined;

  /**
   * Provide a value to return from `toFlowAsync(this)` instead of `this`
   * @ignore
   */
  [_asAsyncFlow]?(): Awaitable<Flow<T, TReturn, TNext>> | undefined;

  /**
   * Observes the flow by calling the given handler function for each item.
   * The handler receives a {@link ScopeContext} with a `value` property for the current value.
   *
   * @see {@linkcode Flow#tryEach}
   * @see {@linkcode Flow#eachValue}
   */
  async each(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<TNext>,
    options?: CancellableOptions,
  ): Promise<TReturn> {
    const out = await this.tryEach(cx => ({ continue: handler(cx) }), options);
    return out.break ?? out.continue;
  }

  /**
   * Observes the flow by calling the given handler function for each item.
   * The handler receives the current value as a parameter.
   * The handler may return {@linkcode ControlFlow.Continue|Continue<TNext>} to continue observing or
   * {@linkcode ControlFlow.Break|Break<B>} to return early.
   *
   * Resolves to {@linkcode ControlFlow.Break|Break<B>} when the handler requests to return early;
   * otherwise resolves to {@linkcode ControlFlow.Continue|Continue<TReturn>} when the flow
   * is completed.
   *
   * @see {@linkcode Flow#tryEach}
   * @see {@linkcode Flow#eachValue}
   */
  tryEachValue<B = never>(
    handler: (value: T) => AsyncControlFlow<B, TNext>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    return this.tryEach(({ value }) => handler(value), options);
  }

  /**
   * Observes the flow by calling the given handler function for each item.
   * The handler receives the current value as a parameter.
   *
   * @see {@linkcode Flow#each}
   * @see {@linkcode Flow#tryEachValue}
   */
  async eachValue(handler: (value: T) => Awaitable<TNext>, options?: CancellableOptions): Promise<TReturn> {
    const out = await this.tryEachValue(value => ({ continue: handler(value) }), options);
    return out.break ?? out.continue;
  }

  async *iter(
    options?: CancellableOptions,
  ): AsyncIterableIterator<{ value: T; scope: Scope }, TReturn, TNext> {
    const token = Token.from(options);

    type Next = { success: true; value: TNext } | { success: false; error: unknown };

    const yieldStream = channel<{ value: T; scope: Scope }>();
    const nextStream = channel<Next>();

    const yieldWriter = yieldStream.sender;
    const yieldReader = yieldStream.receiver;
    const nextWriter = nextStream.sender;
    const nextReader = nextStream.receiver;

    let ret: TReturn | undefined;

    void (async () => {
      try {
        ret = (
          await this.tryEach(
            async cx => {
              const { value } = cx;
              const token = cx.token.filter(e => !(e instanceof FlowError));
              yieldWriter.send({ value, scope: cx.scope.replaceToken(token) });
              const result = await nextReader.next({ token });

              if (result.done) return ControlFlow.BREAK;
              const next = result.value;

              if (next.success) return { continue: next.value };
              throw next.error;
            },
            { token },
          )
        ).continue;
        yieldWriter.close();
      } catch (error) {
        yieldWriter.abort(error);
      }
    })();

    try {
      let result = await yieldReader.next({ token });
      while (!result.done) {
        let next: Next;
        try {
          const value = yield result.value;
          next = { success: true, value };
        } catch (error) {
          next = { success: false, error };
        }

        nextWriter.send(next);
        result = await yieldReader.next({ token });
      }

      return ret!;
    } finally {
      nextWriter.close();
    }
  }

  values(options?: CancellableOptions): AsyncIterableIterator<T, TReturn, TNext> {
    return mapAsyncIterator(this.iter(options), ({ value }) => value);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T, TReturn, TNext> {
    return this.values();
  }

  inScope(scope: ToScope): Flow<T, TReturn, TNext> {
    const newScope = Scope.from(scope);
    const { error } = newScope.token;
    if (error) return cancelledFlow(error);
    if (scope === Scope.static) return this;
    return new FlowWithScope(this, newScope);
  }

  state(this: Flow<T, TReturn, undefined>, options: CancellableOptions & { scope: ToScope }): StateFlow<T> {
    return StateFlow.fromFlow(this, options);
  }

  chain<U = T, UReturn = TReturn>(rhs: ToFlow<U, UReturn, TNext>): Flow<T | U, UReturn, TNext>;
  chain<U = T, UReturn = TReturn>(
    ...flows: [...flows: ToFlow<U, unknown, TNext>[], last: ToFlow<U, UReturn, TNext>]
  ): Flow<T | U, UReturn, TNext>;
  chain<U = T, UReturn = TReturn>(
    ...flows: ToFlow<U, UReturn, TNext>[]
  ): Flow<T | U, TReturn | UReturn, TNext>;
  chain(...rhs: ToFlow<T, any, TNext>[]): Flow<T, TReturn, TNext> {
    return new ChainFlow(
      this,
      rhs.map(flow => () => ({ continue: flow })),
    );
  }

  thenChain<UReturn = TReturn>(rhs: (value: TReturn) => ToFlow<T, UReturn, TNext>): Flow<T, UReturn, TNext>;
  thenChain(...rhs: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>): Flow<T, TReturn, TNext>;
  thenChain(...rhs: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>): Flow<T, TReturn, TNext> {
    return new ChainFlow(
      this,
      rhs.map(fl => value => ({ continue: fl(value) })),
    );
  }

  tryTransformEach<U, UNext, B, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init,
    ) => AsyncControlFlow<B, TNext>,
    init: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Init>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext>;
  tryTransformEach<U, UNext, B, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init?: Init,
    ) => AsyncControlFlow<B, TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Init>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext>;
  tryTransformEach<U, UNext, B, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => AsyncControlFlow<B, TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Init>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext> {
    return defineFlow(async ({ scope, contextWith }) => {
      let initValue: Init | undefined;

      if (init) {
        const initResult = await scope.launch(({ scope }) =>
          ControlFlow.fromAsync(init(contextWith({ scope }))),
        );

        if ('continue' in initResult) {
          initValue = initResult.continue;
        } else {
          return initResult;
        }
      }

      return this.tryEach(({ scope, value }) => fn(contextWith({ scope, values: { value } }), initValue), {
        scope,
      });
    });
  }

  transformEach<U, UNext, Init = undefined>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, init: Init) => Awaitable<TNext>,
    init: (cx: FlowExecutorContext<U, UNext>) => Awaitable<Init>,
  ): Flow<U, TReturn, UNext>;
  transformEach<U, UNext, Init = undefined>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, init?: Init) => Awaitable<TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => Awaitable<Init>,
  ): Flow<U, TReturn, UNext>;
  transformEach<U, UNext, Init = undefined>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      init: Init | undefined,
    ) => Awaitable<TNext>,
    init?: (cx: FlowExecutorContext<U, UNext>) => Awaitable<Init>,
  ): Flow<U, TReturn, UNext> {
    return defineFlow(async ({ scope, contextWith }) => {
      const initValue = init && (await scope.launch(({ scope }) => init(contextWith({ scope }))));
      return this.each(({ scope, value }) => fn(contextWith({ scope, values: { value } }), initValue), {
        scope,
      });
    });
  }

  mapScoped<U, UNext = TNext, UReturn = TReturn>(
    fn?: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
    inputFn?: (cx: ScopeContext<{ value: UNext }>) => Awaitable<TNext>,
    returnFn?: (value: ScopeContext<{ value: TReturn }>) => Awaitable<UReturn>,
  ): Flow<U, UReturn, UNext> {
    return new ScopedMapFlow(this, fn, inputFn, returnFn);
  }

  buffer(this: Flow<T, TReturn, undefined>, size: number, scope?: Scope): Flow<T, TReturn, unknown> {
    return new BufferedFlow(this, size, scope);
  }

  async tryFold<B = never, C = never>(
    this: Flow<T, TReturn, void>,
    fn: (cx: ScopeContext<{ value: T }>, acc: C) => AsyncControlFlow<B, C>,
    init: C,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, C>> {
    let acc = init;
    const out = await this.tryEach(async cx => {
      const out = await fn(cx, acc);
      if ('continue' in out) {
        acc = await out.continue;
        return ControlFlow.CONTINUE;
      }

      return out;
    }, options);

    if ('continue' in out) return { continue: acc };

    return out;
  }

  async fold<C>(
    this: Flow<T, TReturn, void>,
    fn: (cx: ScopeContext<{ value: T }>, sum: C) => Awaitable<C>,
    init: C,
    options?: CancellableOptions,
  ): Promise<C> {
    const out = await this.tryFold(async (cx, acc) => ({ continue: fn(cx, acc) }), init, options);
    return out.break ?? out.continue;
  }

  declare to: typeof pipeThis;
  declare do: typeof pipeThis;
  declare pipe: typeof pipeThis;

  static {
    this.prototype.to = this.prototype.do = this.prototype.pipe = pipeThis;
  }
}

export interface AnyFlow extends Flow<unknown, unknown, never> {}
