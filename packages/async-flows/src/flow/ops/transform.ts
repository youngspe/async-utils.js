import type { ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { defineFlow, Flow, MergeFlow, type FlowExecutorContext, type ToFlow } from '../../flow.ts';
import { type FlowTransformer } from './module.ts';
import type { Defined } from '../../types.ts';
import { DISCARD_INPUT } from '../map.ts';

/**
 * Transforms each value yielded by the flow with access to the full scope context and emit function.
 * The function receives the current value and a context that includes `emit`, `scope`, and the flow's
 * input channel, allowing precise control over emission for each value.
 *
 * @param fn - Transformation function receiving a scope context with the value and emit/input capabilities
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { transformEach } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3).do(
 *   transformEach(async ({ value, emit }) => emit(value * 2)),
 * );
 * ```
 */
export const transformEach =
  <T, TReturn, TNext, U, UNext>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>) => Awaitable<TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, UNext> =>
  src =>
    src.transformEach(fn);

/**
 * Transforms each value yielded by the flow by applying a function to it.
 *
 * @param fn - Mapping function that transforms each value
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { map } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3);
 * const doubleFlow = flow.do(map(value => value * 2));
 *
 * await doubleFlow.each(({ value }) => console.log(value));
 * // Output:
 * // 2
 * // 4
 * // 6
 * ```
 */
export const map =
  <T, TReturn, TNext, U>(
    fn: (value: T) => Awaitable<U>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, TNext> =>
  src =>
    src.mapScoped(({ value }) => fn(value));

/**
 * Transforms each value yielded by the flow with access to the scope context.
 * The function receives a `ScopeContext` wrapping the value and can use scope features
 * (e.g., scope cancellation, delays) during the transformation.
 *
 * @param fn - Mapping function that receives a scope context and returns the transformed value
 */
export function mapScoped<T, TReturn, TNext, U>(
  fn: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, TNext> {
  return src => src.mapScoped(fn);
}

/**
 * Transforms each input value sent back into the flow by consumers (via the iterator's `next()` call).
 *
 * @param fn - Function that transforms input values
 */
export const mapInput =
  <T, TReturn, TNext, UNext = TNext>(
    fn: (value: UNext) => Awaitable<TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn, UNext> =>
  src =>
    src.mapScoped(undefined, ({ value }) => fn(value));

/**
 * Transforms each input value sent back into the flow with access to the scope context.
 *
 * @param fn - Function that receives a scope context with the input value and returns the transformed input
 */
export const mapInputScoped =
  <T, TReturn, TNext, UNext = TNext>(
    fn: (value: ScopeContext<{ value: UNext }>) => Awaitable<TNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, TReturn, UNext> =>
  src =>
    src.mapScoped(undefined, fn);

/**
 * Transforms the return value of the flow when it completes successfully.
 *
 * @param fn - Function that transforms the flow's return value
 */
export const mapReturn =
  <T, TReturn, TNext, UReturn = TReturn>(
    fn: (value: TReturn) => Awaitable<UReturn>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, UReturn, TNext> =>
  src =>
    src.mapScoped(undefined, undefined, ({ value }) => fn(value));

/**
 * Transforms the return value of the flow with access to the scope context.
 *
 * @param fn - Function that receives a scope context with the return value and returns the transformed return value
 */
export const mapReturnScoped =
  <T, TReturn, TNext, UReturn = TReturn>(
    fn: (value: ScopeContext<{ value: TReturn }>) => Awaitable<UReturn>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, T, UReturn, TNext> =>
  src =>
    src.mapScoped(undefined, undefined, fn);

/**
 * Discards all input values sent back into the flow by consumers.
 * This is useful when the flow does not need feedback from consumers.
 */
export const discardInput =
  <T, TReturn>(): FlowTransformer<Flow<T, TReturn, undefined>, T, TReturn, unknown> =>
  src =>
    src.mapScoped(undefined, DISCARD_INPUT);

/**
 * Filters values from the flow based on a predicate. Only values for which the predicate returns
 * truthy are emitted.
 *
 * @param pred - Predicate function; values are emitted when it returns truthy
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { filter } from '@youngspe/async-flows/ops';
 *
 * const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
 * const evens = numbers.do(filter(n => n % 2 === 0));
 *
 * await evens.each(({ value }) => console.log(value));
 * // Output:
 * // 2
 * // 4
 * // 6
 * // 8
 * // 10
 * ```
 */
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

/**
 * Filters out `undefined` values from the flow, yielding only defined values.
 * This is a type-narrowing filter: the output type excludes `undefined`.
 */
export const defined =
  <T, TReturn, TNext>(): FlowTransformer<
    Flow<T | undefined, TReturn, TNext | undefined>,
    Defined<T>,
    TReturn,
    TNext
  > =>
  src =>
    src.transformEach(async ({ emit, value }) => (value !== undefined ? emit(value) : undefined));

/**
 * Maps each value using a function that may return `undefined`, and filters out `undefined` results.
 * Values for which the function returns `undefined` are skipped; all other values are emitted.
 *
 * @param fn - Mapping function that may return `undefined` to skip a value
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { definedMap } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3, 4, 5).do(
 *   definedMap(n => n % 2 === 0 ? n * 2 : undefined),
 * );
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 4
 * // 8
 * ```
 */
export const definedMap =
  <T, TReturn, TNext, U>(
    fn: (value: T) => Awaitable<U | undefined>,
  ): FlowTransformer<Flow<T, TReturn, TNext | undefined>, Defined<U>, TReturn, TNext> =>
  src =>
    src.transformEach(async ({ emit, value }) => {
      const out = await fn(value);
      return out !== undefined ? emit(out) : undefined;
    });

/**
 * Concatenates all items yielded by a flow of flow-likes. Each inner flow-like is consumed
 * sequentially: the next one starts only after the previous one completes.
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { concatAll } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf([1, 2], [3, 4]).do(concatAll());
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 4
 * ```
 */
export const concatAll =
  <T, TReturn, TNext, UNext>(): FlowTransformer<
    Flow<ToFlow<T, NoInfer<TNext>, UNext>, TReturn, TNext>,
    T,
    TReturn,
    UNext
  > =>
  src =>
    src.transformEach(async ({ value, emitAll }) => emitAll(value));

/**
 * Maps each value yielded by the flow into a flow-like value, from which all values will be emitted
 * sequentially. Equivalent to `map(fn)` followed by `concatAll()`.
 *
 * @param fn - Function that maps each value to a flow-like
 *
 * @example
 * ```ts
 * import { defineFlow, flowOf } from '@youngspe/async-flows';
 * import { concatMap } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3);
 * const flowWithRepeats = flow.do(
 *   concatMap(value =>
 *     defineFlow<number>(async ({ emit }) => {
 *       for (let i = 0; i < value; ++i) {
 *         await emit(value);
 *       }
 *     }),
 *   ),
 * );
 *
 * await flowWithRepeats.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 2
 * // 3
 * // 3
 * // 3
 * ```
 */
export const concatMap =
  <T, TReturn, TNext, U, UNext>(
    fn: (value: T) => ToFlow<U, TNext, UNext>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, TReturn, UNext> =>
  src =>
    src.transformEach(async ({ value, emitAll }) => emitAll(fn(value)));

/**
 * Interleave all items from the flow-likes yielded by this stream. Each inner flow-like is consumed
 * concurrently; values are yielded as they arrive from any inner flow.
 *
 * @example
 * ```ts
 * import { defineFlow, type Flow } from '@youngspe/async-flows';
 * import { mergeAll } from '@youngspe/async-flows/ops';
 *
 * const flow = defineFlow<Flow<string>>(async ({ scope, emit }) => {
 *   await emit(
 *     defineFlow(async ({ scope, emit }) => {
 *       await scope.delay(200);
 *       await emit('a1');
 *     }),
 *   );
 *   await emit(
 *     defineFlow(async ({ scope, emit }) => {
 *       await scope.delay(50);
 *       await emit('b1');
 *     }),
 *   );
 * });
 *
 * const merged = flow.do(mergeAll());
 * await merged.each(({ value }) => console.log(value));
 * ```
 */
export const mergeAll =
  <T, TReturn>(): FlowTransformer<
    Flow<ToFlow<T, unknown, unknown>, TReturn, undefined>,
    T,
    TReturn,
    unknown
  > =>
  src =>
    new MergeFlow(src);

/**
 * Maps each value to a flow-like and merges them all concurrently. Values from all inner flows
 * are yielded as they arrive. Equivalent to `map(fn)` followed by `mergeAll()`.
 *
 * @param fn - Function that maps each value to a flow-like
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { mergeMap } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3).do(
 *   mergeMap(n => [n, n * 10]),
 * );
 *
 * await flow.each(({ value }) => console.log(value));
 * ```
 */
export const mergeMap =
  <T, TReturn, U>(
    fn: (value: T) => ToFlow<U, unknown, undefined>,
  ): FlowTransformer<Flow<T, TReturn, undefined>, U, TReturn, unknown> =>
  src =>
    new MergeFlow(src, ({ value }) => fn(value));

/**
 * Transforms each value using a function that emits into the merged output, with full access to the
 * scope context and emit capabilities. The function receives a scope context that includes `emit`
 * and can yield multiple values or perform async work.
 *
 * @param fn - Function that receives a scope context with value and emit, and performs the transformation
 */
export const mergeTransform =
  <T, TReturn, U>(
    fn: (cx: ScopeContext<FlowExecutorContext<U, unknown> & { value: T }>) => void | PromiseLike<unknown>,
  ): FlowTransformer<Flow<T, TReturn, undefined>, U, TReturn, unknown> =>
  src =>
    new MergeFlow(src, ({ value, scope }) =>
      defineFlow(({ contextWith }) => fn(contextWith({ values: { value } })), { scope }),
    );
