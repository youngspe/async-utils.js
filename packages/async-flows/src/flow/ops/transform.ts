import type { ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { defineFlow, Flow, MergeFlow, type FlowExecutorContext, type ToFlow } from '../../flow.ts';
import { type FlowTransformer } from './module.ts';
import type { Defined } from '../../types.ts';
import { DISCARD_INPUT } from '../map.ts';

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
    src.mapScoped(({ value }) => fn(value));

export function mapScoped<T, TReturn, TNext, U>(
  fn: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, TNext> {
  return src => src.mapScoped(fn);
}

export const mapInput =
  <T, TReturn, TNext, UNext = TNext>(
    fn: (value: UNext) => Awaitable<TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn, UNext> =>
  src =>
    src.mapScoped(undefined, ({ value }) => fn(value));

export const mapInputScoped =
  <T, TReturn, TNext, UNext = TNext>(
    fn: (value: ScopeContext<{ value: UNext }>) => Awaitable<TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn, UNext> =>
  src =>
    src.mapScoped(undefined, fn);

export const mapReturn =
  <T, TReturn, TNext, UReturn = TReturn>(
    fn: (value: TReturn) => Awaitable<UReturn>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, UReturn, TNext> =>
  src =>
    src.mapScoped(undefined, undefined, ({ value }) => fn(value));

export const mapReturnScoped =
  <T, TReturn, TNext, UReturn = TReturn>(
    fn: (value: ScopeContext<{ value: TReturn }>) => Awaitable<UReturn>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, UReturn, TNext> =>
  src =>
    src.mapScoped(undefined, undefined, fn);

export const discardInput =
  <T, TReturn>(): FlowTransformer<Flow<T, TReturn, undefined>, T, TReturn, unknown> =>
  src =>
    src.mapScoped(undefined, DISCARD_INPUT);

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

export const concatAll =
  <T, TReturn, TNext, UNext>(): FlowTransformer<
    Flow<ToFlow<T, NoInfer<TNext>, UNext>, TReturn, TNext>,
    T,
    TReturn,
    UNext
  > =>
  src =>
    src.transformEach(async ({ value, emitAll }) => emitAll(value));

export const concatMap =
  <T, TReturn, TNext, U, UNext>(
    fn: (value: T) => ToFlow<U, TNext, UNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, UNext> =>
  src =>
    src.transformEach(async ({ value, emitAll }) => emitAll(fn(value)));

export const mergeAll =
  <T, TReturn>(): FlowTransformer<
    Flow<ToFlow<T, unknown, unknown>, TReturn, undefined>,
    T,
    TReturn,
    unknown
  > =>
  src =>
    new MergeFlow(src);

export const mergeMap =
  <T, TReturn, U>(
    fn: (value: T) => ToFlow<U, unknown, undefined>,
  ): FlowTransformer<Flow<T, TReturn, undefined>, U, TReturn, unknown> =>
  src =>
    new MergeFlow(src, ({ value }) => fn(value));

export const mergeTransform =
  <T, TReturn, U>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, unknown> & { value: T }>) => void | PromiseLike<unknown>,
  ): FlowTransformer<Flow<T, TReturn, undefined>, U, TReturn, unknown> =>
  src =>
    new MergeFlow(src, ({ value, scope }) =>
      defineFlow(({ contextWith }) => fn(contextWith({ values: { value } })), { scope }),
    );
