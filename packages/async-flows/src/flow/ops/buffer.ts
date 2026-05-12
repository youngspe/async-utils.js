import type { ScopeContext } from '@youngspe/async-scope';
import { ControlFlow, type AsyncControlFlow } from '../../controlFlow.js';
import { type Flow, type FlowExecutorContext } from '../../flow.ts';
import { TryReducerFlow } from '../buffered.ts';
import type { Awaitable } from '@youngspe/async-scope-common';
import { compose, type FlowTransformer } from './module.ts';
import { discardInput, map } from './transform.ts';

export const buffer =
  <T, TReturn>(size: number): FlowTransformer<Flow<T, TReturn, undefined>, T, TReturn, unknown> =>
  src =>
    src.buffer(size);

interface BuffersState<T> {
  buffer: T[];
  running:
    | { resolvers: { resolve: () => void; reject: (reason: unknown) => void } | undefined }
    | undefined;
}

export const buffers = <T, TReturn>(
  size: number,
): FlowTransformer<Flow<T, TReturn, undefined>, T[], TReturn, unknown> =>
  size <= 1 ?
    compose(
      map(x => [x]),
      discardInput(),
    )
  : bufferReduce(
      async ({ value, emit, cancel }, state: BuffersState<T>): Promise<BuffersState<T>> => {
        state.buffer.push(value);

        if (!state.running) {
          const running: BuffersState<T>['running'] = (state.running = { resolvers: undefined });

          (async () => {
            try {
              while (state.buffer.length) {
                const { buffer } = state;
                state.buffer = [];

                try {
                  await emit(buffer);
                  running.resolvers?.resolve();
                } catch (error) {
                  running.resolvers?.reject(error);
                  throw error;
                } finally {
                  running.resolvers = undefined;
                }
              }
            } finally {
              state.running = undefined;
            }
          })().catch(cancel);

          return state;
        }

        if (state.buffer.length >= size) {
          const { running } = state;
          await new Promise<void>((resolve, reject) => {
            running.resolvers = { resolve, reject };
          });
        }

        return state;
      },
      (): BuffersState<T> => ({ buffer: [], running: undefined }),
      async ({ value, emit }, state) => {
        if (state.running) {
          const { running } = state;
          await new Promise<void>((resolve, reject) => {
            running.resolvers = { resolve, reject };
          });
        }

        if (state.buffer.length > 0) {
          await emit(state.buffer);
        }

        return value;
      },
    );

export function tryBufferReduce<
  T,
  TReturn,
  Acc = T,
  U = T,
  UReturn = undefined,
  UNext = unknown,
  B = never,
>(
  reducer: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    acc: Acc,
  ) => AsyncControlFlow<B, Acc>,
  init: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Acc>,
  onComplete: (
    cx: FlowExecutorContext<U, UNext> & { value: TReturn },
    acc: Acc,
  ) => AsyncControlFlow<B, UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, ControlFlow<B, UReturn>, UNext>;
export function tryBufferReduce<T, TReturn, Acc = T, U = T, UReturn = TReturn, UNext = unknown, B = never>(
  reducer: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    acc: Acc,
  ) => AsyncControlFlow<B, Acc>,
  init: (cx: FlowExecutorContext<U, UNext>) => AsyncControlFlow<B, Acc>,
  onComplete?: (
    cx: FlowExecutorContext<U, UNext> & { value: TReturn },
    acc: Acc,
  ) => AsyncControlFlow<B, TReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, ControlFlow<B, TReturn | UReturn>, UNext>;

export function tryBufferReduce<
  T,
  TReturn,
  Acc = T,
  U = T,
  UReturn = undefined,
  UNext = unknown,
  B = never,
>(
  reducer: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    acc: T | Acc,
  ) => AsyncControlFlow<B, Acc>,
  init: ((cx: ScopeContext<FlowExecutorContext<U, UNext>>) => AsyncControlFlow<B, Acc>) | undefined,
  onComplete: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: T | Acc | undefined,
  ) => AsyncControlFlow<B, UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, ControlFlow<B, UReturn>, UNext>;
export function tryBufferReduce<T, TReturn, Acc = T, U = T, UReturn = TReturn, UNext = unknown, B = never>(
  reducer: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    acc: T | Acc,
  ) => AsyncControlFlow<B, Acc>,
  init?: (cx: ScopeContext<FlowExecutorContext<U, UNext>>) => AsyncControlFlow<B, Acc>,
  onComplete?: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: T | Acc | undefined,
  ) => AsyncControlFlow<B, TReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, ControlFlow<B, TReturn | UReturn>, UNext>;
export function tryBufferReduce<
  T,
  TReturn,
  Acc = T,
  U = T,
  UReturn = undefined,
  UNext = unknown,
  B = never,
>(
  reducer: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    acc: Acc,
  ) => AsyncControlFlow<B, Acc>,
  init?: (cx: ScopeContext<FlowExecutorContext<U, UNext>>) => AsyncControlFlow<B, Acc>,
  onComplete?: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: Acc | undefined,
  ) => AsyncControlFlow<B, UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, ControlFlow<B, UReturn>, UNext> {
  return src => new TryReducerFlow(src, reducer, init, onComplete, undefined, undefined);
}

export function bufferReduce<T, TReturn, Acc = T, U = T, UReturn = TReturn, UNext = unknown>(
  reducer: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, acc: Acc) => Awaitable<Acc>,
  init: (cx: ScopeContext<FlowExecutorContext<U, UNext>>) => Awaitable<Acc>,
  onComplete: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: Acc,
  ) => Awaitable<UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, UReturn, UNext>;
export function bufferReduce<T, TReturn, Acc = T, U = T, UReturn = undefined, UNext = unknown>(
  reducer: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, acc: Acc) => Awaitable<Acc>,
  init: (cx: ScopeContext<FlowExecutorContext<U, UNext>>) => Awaitable<Acc>,
  onComplete?: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: Acc,
  ) => Awaitable<UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, TReturn | UReturn, UNext>;
export function bufferReduce<T, TReturn, Acc = T, U = T, UReturn = TReturn, UNext = unknown>(
  reducer: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, acc: T | Acc) => Awaitable<Acc>,
  init: ((cx: ScopeContext<FlowExecutorContext<U, UNext>>) => Awaitable<Acc>) | undefined,
  onComplete: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: T | Acc | undefined,
  ) => Awaitable<UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, UReturn, UNext>;
export function bufferReduce<T, TReturn, Acc = T, U = T, UReturn = TReturn, UNext = unknown>(
  reducer: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, acc: T | Acc) => Awaitable<Acc>,
  init?: (cx: ScopeContext<FlowExecutorContext<U, UNext>>) => Awaitable<Acc>,
  onComplete?: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc: T | Acc | undefined,
  ) => Awaitable<UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, TReturn | UReturn, UNext>;
export function bufferReduce<T, TReturn, Acc = T, U = T, UReturn = TReturn, UNext = unknown>(
  reducer: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>, acc: Acc) => Awaitable<Acc>,
  init?: (cx: ScopeContext<FlowExecutorContext<U, UNext>>) => Awaitable<Acc>,
  onComplete?: (
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
    acc?: Acc,
  ) => Awaitable<UReturn>,
): FlowTransformer<Flow<T, TReturn, undefined>, U, UReturn, UNext> {
  return src =>
    new TryReducerFlow(
      src,
      (cx, acc: Acc) => ({ continue: reducer(cx, acc) }),
      init && (cx => ({ continue: init(cx) })),
      onComplete && ((cx, acc?: Acc) => ({ continue: onComplete(cx, acc) })),
      ControlFlow.unwrap,
      undefined,
    );
}
