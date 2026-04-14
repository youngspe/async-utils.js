import { channel, mapAsyncIterator } from '@youngspe/async-iter-utils';

import {
  Scope,
  Token,
  type CancellableOptions,
  type ScopeContext,
  type ToScope,
} from '@youngspe/async-scope';
import { ControlFlow } from '../controlFlow.ts';
import {
  StateFlow,
  type FlowExecutorContext,
  FlowWithScope,
  ChainFlow,
  type ToFlow,
  cancelledFlow,
  defineFlow,
} from '../flow.ts';
import { pipeThis } from './ops/module.ts';
import type { Awaitable } from '@youngspe/async-scope-common';

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
  declare [_itemMarker]?: { value: T };
  declare [_retMarker]?: { value: TReturn };
  abstract tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>>;

  declare repeatable?: boolean | undefined;

  [_asFlow]?(): Flow<T, TReturn, TNext> | undefined;
  [_asAsyncFlow]?(): Awaitable<Flow<T, TReturn, TNext>> | undefined;

  async each(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<TNext>,
    options?: CancellableOptions,
  ): Promise<TReturn> {
    const out = await this.tryEach(cx => ({ continue: handler(cx) }), options);
    return out.break ?? out.continue;
  }
  tryEachValue<B = never>(
    handler: (value: T) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    return this.tryEach(({ value }) => handler(value), options);
  }
  async eachValue(handler: (value: T) => Awaitable<TNext>, options?: CancellableOptions): Promise<TReturn> {
    const out = await this.tryEachValue(value => ({ continue: handler(value) }), options);
    return out.break ?? out.continue;
  }

  async *iter(
    options?: CancellableOptions,
  ): AsyncIterableIterator<{ value: T; scope: Scope }, TReturn, TNext> {
    const token = Token.from(options);

    type Next = { success: true; value: TNext } | { success: false; error: unknown };
    // const yieldStream = new TransformStream<{ value: T; scope: Scope }, { value: T; scope: Scope }>();
    // const nextStream = new TransformStream<Next, Next>();

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
              const { token } = cx;
              yieldWriter.send(cx);
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
  chain(...rhs: Flow<T, TReturn, TNext>[]): Flow<T, TReturn, TNext> {
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

  tryTransformEach<U, UNext, B>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    ) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
  ): Flow<U, ControlFlow<B, TReturn>, UNext> {
    return defineFlow(({ emitScoped, emitAll, scope }) =>
      this.tryEach(
        ({ scope }) =>
          fn(
            scope.getContext({
              values: {
                emit: (value, ...args) => emitScoped({ value, scope }, ...args),
                emitScoped: (cx, ...args) => emitScoped({ ...cx, scope: [scope, cx.scope] }, ...args),
                emitAll: (src, opts) => emitAll(src, { ...opts, scope: [scope, opts?.scope] }),
              } satisfies FlowExecutorContext<U, UNext>,
            }),
          ),
        { scope },
      ),
    );
  }

  transformEach<U, UNext>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>) => Awaitable<TNext>,
  ): Flow<U, TReturn, UNext> {
    return defineFlow(({ emitScoped, emitAll, scope }) =>
      this.each(
        ({ scope }) =>
          fn(
            scope.getContext({
              values: {
                emit: (value, ...args) => emitScoped({ value, scope }, ...args),
                emitScoped: (cx, ...args) => emitScoped({ ...cx, scope: [scope, cx.scope] }, ...args),
                emitAll: (src, opts) => emitAll(src, { ...opts, scope: [scope, opts?.scope] }),
              } satisfies FlowExecutorContext<U, UNext>,
            }),
          ),
        { scope },
      ),
    );
  }

  async tryFold<B = never, C = never>(
    this: Flow<T, TReturn, void>,
    fn: (cx: ScopeContext<{ value: T }>, acc: C) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<C>>>,
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
