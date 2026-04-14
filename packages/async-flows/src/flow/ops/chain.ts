import { unwrapCancellationError } from '@youngspe/async-scope';
import { defineFlow, Flow, type ToFlow } from '../../flow.ts';
import type { AsyncPredicate, FlowTransformer } from './module.ts';

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

export function orCatch<T, TReturn, TNext, U = T, UReturn = TReturn, E = unknown>(
  handler: (error: E) => ToFlow<U, UReturn, TNext>,
  pred: (error: unknown) => error is E,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext>;
export function orCatch<T, TReturn, TNext, U = T, UReturn = TReturn>(
  handler: (error: unknown) => ToFlow<U, UReturn, TNext>,
  pred: AsyncPredicate<[error: unknown]>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext>;
export function orCatch<T, TReturn, TNext, U = T, UReturn = TReturn>(
  handler: (error: unknown) => ToFlow<U, UReturn, TNext>,
  pred: AsyncPredicate<[error: unknown]>,
): FlowTransformer<Flow<T, TReturn, TNext>, T | U, TReturn | UReturn, TNext> {
  return src =>
    defineFlow(async ({ emitAll }) => {
      try {
        return await emitAll(src);
      } catch (error) {
        if (!(await pred(error)) || (error instanceof Error && unwrapCancellationError(error))) throw error;

        return await emitAll(handler(src));
      }
    });
}
