import type { ScopeContext } from '@youngspe/async-scope';
import { ControlFlow, type AsyncControlFlow } from '../../controlFlow.js';
import { type Flow, type FlowExecutorContext } from '../../flow.ts';
import { TryReducerFlow } from '../buffered.ts';
import type { Awaitable } from '@youngspe/async-scope-common';
import { compose, type FlowTransformer } from './module.ts';
import { discardInput, map } from './transform.ts';

/**
 * While a handler is running asynchronously, continues receiving up to the given number of items from
 * the original flow and yields each one when the current handler is complete.
 * This prevents blocking the flow's producer if the flow's consumer sometimes takes too long to handle
 * a yielded item.
 *
 * @param size - Maximum number of items to buffer while a handler is running
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { buffer } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
 * const buffered = flow.do(buffer(3));
 *
 * await buffered.each(async ({ value, scope }) => {
 *   console.log(value);
 *   await scope.delay(10);
 * });
 * ```
 */
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

/**
 * While a handler is running asynchronously, continues receiving up to the given number of items from
 * the original flow. The buffered items are yielded at once in an array.
 *
 * A value is yielded immediately if available, so the first item is always a single-element array.
 *
 * @param size - Maximum number of items to buffer (yielded as an array when the handler is complete)
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { buffers } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
 * const buffered = flow.do(buffers(3));
 *
 * await buffered.each(async ({ value, scope }) => {
 *   console.log(...value);
 *   await scope.delay(10);
 * });
 * // Output:
 * // 1
 * // 2 3 4
 * // 5 6 7
 * // 8 9 10
 * ```
 */
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

/**
 * Creates a flow operator that tracks accumulated state across emitted values,
 * with support for early termination via `ControlFlow.Break`.
 *
 * Each value from the source flow is passed to a `reducer` function along with the
 * current accumulator. An `init` function provides the initial accumulator value,
 * and an `onComplete` handler transforms the final accumulator and the flow's return
 * value into the output flow's return value.
 *
 * @param reducer - Called for each value with the current accumulator; returns a `ControlFlow` directing continuation or break
 * @param init - Initializes the accumulator state before any values are processed
 * @param onComplete - Transforms the final accumulator and the flow's return value into the output return value
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { tryBufferReduce } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3, 4, 5).do(
 *   tryBufferReduce(
 *     async ({ value, emit }, sum) => {
 *       const newSum = sum + value;
 *       await emit(newSum);
 *       return { continue: newSum };
 *     },
 *     async () => ({ continue: 0 }),
 *     async ({ value }, sum) => {
 *       console.log(sum);
 *       return { continue: value };
 *     },
 *   ),
 * );
 *
 * await flow.each(({ value }) => {
 *   console.log(value);
 * });
 * // Output:
 * // 1
 * // 3
 * // 6
 * // 10
 * // 15
 * // 15
 * ```
 */
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
    cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: TReturn }>,
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

/**
 * Creates a flow operator that tracks accumulated state across emitted values.
 *
 * Each value from the source flow is passed to a `reducer` function along with the
 * current accumulator. An `init` function provides the initial accumulator value,
 * and an `onComplete` handler transforms the final accumulator and the flow's return
 * value into the output flow's return value.
 *
 * Unlike {@link tryBufferReduce}, the reducer cannot signal early termination.
 *
 * @param reducer - Called for each value with the current accumulator; returns the new accumulator
 * @param init - Initializes the accumulator state before any values are processed
 * @param onComplete - Transforms the final accumulator and the flow's return value into the output return value
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { bufferReduce } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3, 4, 5).do(
 *   bufferReduce(
 *     async ({ value, emit }, sum) => {
 *       const newSum = sum + value;
 *       await emit(newSum);
 *       return newSum;
 *     },
 *     () => 0,
 *     async ({ value }, sum) => {
 *       console.log(sum);
 *       return value;
 *     },
 *   ),
 * );
 *
 * await flow.each(({ value }) => {
 *   console.log(value);
 * });
 * // Output:
 * // 1
 * // 3
 * // 6
 * // 10
 * // 15
 * // 15
 * ```
 */
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
