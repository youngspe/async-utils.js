import type { Awaitable } from '@youngspe/async-scope-common';
import { ControlFlow } from '../../controlFlow.ts';
import { defineFlow, Flow } from '../../flow.ts';
import type { FlowTransformer } from './module.ts';

/**
 * Takes only the first N values from the flow and then completes the resulting flow.
 *
 * @param n - Maximum number of values to take
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { take } from '@youngspe/async-flows/ops';
 *
 * const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
 * const firstFive = numbers.do(take(5));
 *
 * await firstFive.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 4
 * // 5
 * ```
 */
export const take =
  <T, TReturn, TNext>(n: number): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn | undefined, TNext> =>
  src =>
    defineFlow(async ({ emitScoped, scope }) => {
      let i = 0;

      const out = await src.tryEach(
        cx => {
          if (i++ >= n) return ControlFlow.BREAK;

          return { continue: emitScoped(cx) };
        },
        { scope },
      );

      return out.continue;
    });

/**
 * Takes values from the flow while the provided predicate returns true. As soon as the predicate
 * returns false, the resulting flow completes (with the rejected value as its return value).
 *
 * @param pred - A predicate function. Values are emitted while it returns truthy; the first falsy
 *   value causes the flow to complete and becomes the return value.
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { takeWhile } from '@youngspe/async-flows/ops';
 *
 * const evens = flowOf(1, 2, 3, 4, 5, 6, 7, 8).do(takeWhile(n => n < 5));
 *
 * await evens.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 4
 * ```
 */
export function takeWhile<T, TReturn, TNext, U extends T>(
  pred: (value: T) => value is U,
): FlowTransformer<Flow<T | U, TReturn, TNext>, U, TReturn | Exclude<T, U>, TNext>;
export function takeWhile<T, TReturn, TNext>(
  pred: (value: T) => Awaitable<boolean | NonNullable<unknown> | null | undefined>,
): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn | T, TNext>;
export function takeWhile<T, TReturn, TNext>(
  pred: (value: T) => Awaitable<boolean | NonNullable<unknown> | null | undefined>,
): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn | T, TNext> {
  return src =>
    defineFlow(async ({ emitScoped, scope }) => {
      const out = await src.tryEach(
        async cx => {
          const { value } = cx;
          if (!(await pred(value))) return { break: value };
          return { continue: emitScoped(cx) };
        },
        { scope },
      );

      return 'continue' in out ? out.continue : out.break;
    });
}
