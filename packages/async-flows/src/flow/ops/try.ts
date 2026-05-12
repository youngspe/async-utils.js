import type { ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import type { AsyncControlFlow, ControlFlow } from '../../controlFlow.ts';
import { Flow, type FlowExecutorContext } from '../../flow.ts';
import { type FlowTransformer } from './module.ts';

/**
 * Transforms each value with support for early termination via `ControlFlow.Break`.
 * The function returns a `ControlFlow` that either continues with the next value or breaks
 * the flow entirely.
 *
 * @param fn - Transformation function returning a `ControlFlow` to continue or break
 */
export const tryTransformEach =
  <T, TReturn, TNext, U, UNext, B>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>) => AsyncControlFlow<B, TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, ControlFlow<B, TReturn>, UNext> =>
  src =>
    src.tryTransformEach(fn);

/**
 * Maps values from the flow using a function that returns either `{ continue: U }` (proceeds to next
 * value) or `{ break: B }` (stops emitting). This allows transforming values with the ability to
 * signal early termination of the flow.
 *
 * @param fn - Function that maps each value to a `ControlFlow` — use `{ continue: value }` to emit
 *   and proceed, or `{ break: result }` to terminate the flow
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { tryMap } from '@youngspe/async-flows/ops';
 *
 * const numbers = flowOf(1, 2, 3, 4, 5);
 * const mapped = numbers.do(
 *   tryMap(n => {
 *     if (n === 4) return { break: undefined };
 *     return { continue: n * 2 };
 *   }),
 * );
 *
 * await mapped.each(({ value }) => console.log(value));
 * // Output:
 * // 2
 * // 4
 * // 6
 * ```
 */
export const tryMap =
  <T, TReturn, TNext, U, B>(
    fn: (value: T) => AsyncControlFlow<B, U>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, ControlFlow<B, TReturn>, TNext> =>
  src =>
    src.tryTransformEach(async ({ value, emit }) => {
      const out = await fn(value);
      if (!('continue' in out)) return out;
      return { continue: emit(out.continue) };
    });
