import { Deque } from '@youngspe/common-async-utils';
import { Scope, Token, type ScopeContext, type Subscription } from '@youngspe/async-scope';

import { Flow } from '#pkg/flow';
import { ControlFlow, type AsyncControlFlow } from '#pkg/controlFlow';

import { AbstractFlow, type FlowExecutorContext, FlowError } from './abstract.ts';

export class TryReducerFlow<
  T,
  TReturn = unknown,
  Acc = T,
  B = never,
  U = T,
  UReturn = TReturn,
  UNext = unknown,
  VReturn = ControlFlow<B, UReturn>,
> extends AbstractFlow<U, VReturn, UNext> {
  #inner;
  #reducer;
  #init;
  #onComplete;
  #unwrapReturn;

  constructor(
    inner: Flow<T, TReturn, undefined>,
    reducer: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
      acc: Acc,
    ) => AsyncControlFlow<B, Acc>,
    init: ((cx: ScopeContext<FlowExecutorContext<U, UNext>>) => AsyncControlFlow<B, Acc>) | undefined,
    onComplete:
      | ((
          cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
          acc: Acc | undefined,
        ) => AsyncControlFlow<B, UReturn>)
      | undefined,
    unwrapReturn: ((value: ControlFlow<B, UReturn>) => VReturn) | undefined,
    scope: Scope | undefined,
  ) {
    super(scope);
    this.#inner = inner;
    this.#reducer = reducer;
    this.#init = init;
    this.#unwrapReturn = unwrapReturn;
    this.#onComplete = onComplete;
  }

  protected override async _each(cx: ScopeContext<FlowExecutorContext<U, UNext>>): Promise<VReturn> {
    const { contextWith, scope } = cx;

    const newCtrl = () =>
      Token.createController({
        filter: e => !(e instanceof FlowError),
        onAfterCancel: () => {
          ctrl = newCtrl();
        },
      });
    let ctrl = newCtrl();
    let ctrlSub: Subscription | undefined;

    return (async (): Promise<ControlFlow<B, UReturn>> => {
      let acc: ControlFlow.Continue<Acc> | undefined;
      const initFn = this.#init;

      if (initFn) {
        const result = await ControlFlow.fromAsync(initFn(contextWith({ token: ctrl })));

        if (ControlFlow.isBreak(result)) return result;
        acc = result;
      }

      const reducer = this.#reducer;

      const innerRet = await this.#inner.tryEach<B>(
        async ({ value, scope }) => {
          ctrlSub?.dispose();
          ctrlSub = scope.token.add(ctrl);
          if (!acc) {
            acc = { continue: value as T & Acc };
            return ControlFlow.CONTINUE;
          }

          const result = await ControlFlow.fromAsync(
            reducer(contextWith({ values: { value }, token: ctrl }), acc.continue),
          );

          if (ControlFlow.isBreak(result)) return result;
          acc = result;
          return ControlFlow.CONTINUE;
        },
        { scope },
      );

      ctrlSub?.dispose();
      ctrl.defuse();

      const onComplete = this.#onComplete;

      if (!onComplete) {
        return innerRet as ControlFlow<B, TReturn & UReturn>;
      }

      if (ControlFlow.isBreak(innerRet)) return innerRet;
      const value = innerRet.continue;

      return await ControlFlow.fromAsync(
        onComplete(contextWith({ values: { value }, token: ctrl }), acc?.continue),
      );
    })().then(this.#unwrapReturn);
  }
}

interface BufferedFlowState<T> {
  queue: Deque<T>;
  running:
    | { resolvers: { resolve: () => void; reject: (reason: unknown) => void } | undefined }
    | undefined;
  completed: Promise<void> | undefined;
}

export class BufferedFlow<T, TReturn> extends TryReducerFlow<
  T,
  TReturn,
  BufferedFlowState<T>,
  never,
  T,
  TReturn,
  unknown,
  TReturn
> {
  #inner;
  #size;

  constructor(inner: Flow<T, TReturn, undefined>, size: number, scope: Scope | undefined) {
    const emitterLoop = async (
      value: T,
      emit: (value: T) => Promise<unknown>,
      state: BufferedFlowState<T>,
    ) => {
      try {
        const running: BufferedFlowState<T>['running'] = (state.running = { resolvers: undefined });

        while (true) {
          try {
            await emit(value);
            running.resolvers?.resolve();
          } catch (error) {
            running.resolvers?.reject(error);

            throw error;
          } finally {
            running.resolvers = undefined;
          }

          const nextValue = state.queue.shiftN(1);
          if (!nextValue) return;

          [value] = nextValue;
        }
      } finally {
        state.running = state.completed = undefined;
      }
    };

    super(
      inner,
      async ({ emit, value, cancel }, state) => {
        const { queue, running } = state;

        if (!running) {
          state.completed = emitterLoop(value, emit, state).catch(cancel);
          return { continue: state };
        }

        queue.push(value);

        if (queue.size >= size) {
          await new Promise<void>((resolve, reject) => {
            running.resolvers = { resolve, reject };
          });
        }

        return { continue: state };
      },
      () => {
        const state: BufferedFlowState<T> = {
          queue: new Deque(),
          running: undefined,
          completed: undefined,
        };

        return { continue: state };
      },
      async ({ value }, state) => {
        if (state) {
          await state.completed;
        }

        return { continue: value };
      },
      ControlFlow.unwrap,
      scope,
    );

    this.#inner = inner;
    this.#size = size;
  }

  protected override _inScope(scope: Scope) {
    return new BufferedFlow(this.#inner, this.#size, scope);
  }

  protected override _buffer(size: number, scope: Scope) {
    if (size <= this.#size) {
      if (scope === this._scope) return this;
      size = this.#size;
    }

    return new BufferedFlow(this.#inner, size, scope);
  }
}
