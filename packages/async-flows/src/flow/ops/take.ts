import type { Awaitable } from '@youngspe/async-scope-common';
import { ControlFlow } from '../../controlFlow.ts';
import { defineFlow, Flow } from '../../flow.ts';
import type { FlowTransformer } from './module.ts';

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
