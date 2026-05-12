import { unwrapCancellationError } from '@youngspe/async-scope';
import { defineFlow, Flow, type ToFlow } from '../../flow.ts';
import type { AsyncPredicate, FlowTransformer } from './module.ts';

/**
 * Concatenates one or more flows or flow-likes to the end of the source flow.
 * After the source flow completes, each additional flow is consumed in sequence.
 * The return value of the last flow becomes the return value of the result.
 *
 * @param flows - One or more flow-like values to append sequentially after the source completes
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { chain } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3).do(chain([4, 5], [6, 7]));
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 4
 * // 5
 * // 6
 * // 7
 * ```
 */
export function chain<T, TReturn, TNext, U = T, UReturn = TReturn>(
  ...flows: [...flows: ToFlow<U, unknown, TNext>[], last: ToFlow<U, UReturn, TNext>]
): FlowTransformer<Flow<T, unknown, TNext>, T | U, UReturn, TNext>;
export function chain<T, TReturn, TNext, U = T, UReturn = TReturn>(
  ...flows: ToFlow<U, UReturn, TNext>[]
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext>;
export function chain<T, TReturn, TNext>(
  ...flows: ToFlow<T, TReturn, TNext>[]
): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn, TNext> {
  return src => src.chain(...flows);
}

/**
 * After all values from the original flow have been emitted, calls the given function and yields all
 * values from the resulting flow-like.
 *
 * @param flows - Functions that receive the source flow's return value and return a flow-like to append
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { andThen } from '@youngspe/async-flows/ops';
 *
 * const numbers = flowOf(1, 2, 3);
 * const appended = numbers.do(andThen(() => [4, 5, 6]));
 *
 * await appended.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 4
 * // 5
 * // 6
 * ```
 */
export function andThen<T, TReturn, TNext, U = T, A = TReturn>(
  a: (value: TReturn) => ToFlow<U, A, TNext>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, A, TNext>;
export function andThen<T, TReturn, TNext, U = T, A = TReturn, B = A>(
  a: (value: TReturn) => ToFlow<U, A, TNext>,
  b: (value: A) => ToFlow<U, B, TNext>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, B, TNext>;
export function andThen<T, TReturn, TNext, U = T, A = TReturn, B = A, C = B>(
  a: (value: TReturn) => ToFlow<U, A, TNext>,
  b: (value: A) => ToFlow<U, B, TNext>,
  c: (value: B) => ToFlow<U, C, TNext>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, C, TNext>;
export function andThen<T, TReturn, TNext, U = T, UReturn = TReturn>(
  ...flows: Array<(value: TReturn | UReturn) => ToFlow<U, UReturn, TNext>>
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext>;
export function andThen<T, TReturn, TNext>(
  ...flows: Array<(value: TReturn) => ToFlow<T, TReturn, TNext>>
): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn, TNext> {
  return src => src.thenChain(...flows);
}

/**
 * If the flow completes with an error, calls the given function and yields all values from the
 * resulting flow-like.
 *
 * An optional predicate can be provided to only catch errors that match a specific condition.
 * Cancellation errors are always re-thrown.
 *
 * @param handler - Function that receives the error and returns a recovery flow-like
 * @param pred - Optional predicate to filter which errors are caught
 *
 * @example
 * ```ts
 * import { defineFlow } from '@youngspe/async-flows';
 * import { orCatch } from '@youngspe/async-flows/ops';
 *
 * const failingFlow = defineFlow(async ({ emitAll }) => {
 *   await emitAll([1, 2, 3]);
 *   throw new Error('Oh no!');
 * });
 *
 * const recovered = failingFlow.do(
 *   orCatch(() => [4, 5, 6]),
 * );
 *
 * await recovered.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 4
 * // 5
 * // 6
 * ```
 */
export function orCatch<T, TReturn, TNext, U = T, UReturn = TReturn, E = unknown>(
  handler: (error: E) => ToFlow<U, UReturn, TNext>,
  pred: (error: unknown) => error is E,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext>;
export function orCatch<T, TReturn, TNext, U = T, UReturn = TReturn>(
  handler: (error: unknown) => ToFlow<U, UReturn, TNext>,
  pred?: AsyncPredicate<[error: unknown]>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext>;
export function orCatch<T, TReturn, TNext, U = T, UReturn = TReturn>(
  handler: (error: unknown) => ToFlow<U, UReturn, TNext>,
  pred?: AsyncPredicate<[error: unknown]>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext> {
  return src =>
    defineFlow(async ({ emitAll }) => {
      try {
        return await emitAll(src);
      } catch (error) {
        if ((pred && !(await pred(error))) || (error instanceof Error && unwrapCancellationError(error)))
          throw error;

        return await emitAll(handler(src));
      }
    });
}
