import type { ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { Flow, toFlowAsync, type FlowExecutorContext, type ToFlow } from '../../flow.ts';
import { type FlowTransformer } from './module.ts';
import type { Defined } from '../../types.ts';

export const transformEach =
  <T, TReturn, TNext, U, UNext>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>) => Awaitable<TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, UNext> =>
  src =>
    src.transformEach(fn);

export const map =
  <T, TReturn, TNext, U>(
    fn: (value: T) => Awaitable<U>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, TNext> =>
  src =>
    src.transformEach(({ value, emit }) => emit(fn(value)));

export const mapScoped =
  <T, TReturn, TNext, U>(
    fn: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, TNext> =>
  src =>
    src.transformEach(({ value, emit, scope }) => emit(fn(scope.getContext({ values: { value } }))));

export function filter<T, TReturn, TNext, U extends T>(
  pred: (value: T) => value is U,
): FlowTransformer<Flow<T | U, TReturn, TNext | undefined>, U, TReturn, TNext>;
export function filter<T, TReturn, TNext>(
  pred: (value: T) => unknown,
): FlowTransformer<Flow<T, TReturn, TNext | undefined>, T, TReturn, TNext>;
export function filter<T, TReturn, TNext>(
  pred: (value: T) => unknown,
): FlowTransformer<Flow<T, TReturn, TNext | undefined>, T, TReturn, TNext> {
  return src =>
    src.transformEach(async ({ emit, value }) => ((await pred(value)) ? emit(value) : undefined));
}

export const defined =
  <T, TReturn, TNext>(): FlowTransformer<
    Flow<T | undefined, TReturn, TNext | undefined>,
    Defined<T>,
    TReturn,
    TNext
  > =>
  src =>
    src.transformEach(async ({ emit, value }) => (value !== undefined ? emit(value) : undefined));

export const definedMap =
  <T, TReturn, TNext, U>(
    fn: (value: T) => Awaitable<U | undefined>,
  ): FlowTransformer<Flow<T, TReturn, TNext | undefined>, Defined<U>, TReturn, TNext> =>
  src =>
    src.transformEach(async ({ emit, value }) => {
      const out = await fn(value);
      return out !== undefined ? emit(out) : undefined;
    });

export const flat =
  <T, TReturn, TNext, UNext>(): FlowTransformer<
    Flow<ToFlow<T, NoInfer<TNext>, UNext>, TReturn, TNext>,
    T,
    TReturn,
    UNext
  > =>
  src =>
    src.transformEach(async ({ value, emitScoped, scope }) =>
      (await toFlowAsync(value)).each(emitScoped, { scope }),
    );

export const flatMap =
  <T, TReturn, TNext, U, UNext>(
    fn: (value: T) => ToFlow<U, TNext, UNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, UNext> =>
  src =>
    src.transformEach(async ({ value, emitScoped, scope }) =>
      (await toFlowAsync(fn(value))).each(emitScoped, { scope }),
    );
