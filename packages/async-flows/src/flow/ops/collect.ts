import type { Awaitable } from '@youngspe/async-scope-common';
import { CancellationError, type CancellableOptions } from '@youngspe/async-scope';

import type { Flow } from '../../flow.ts';
import type { FlowCollector } from './module.ts';

/**
 * Collects all values yielded by the flow into an array.
 *
 * @param options - Optional cancellation options
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { collectArray } from '@youngspe/async-flows/ops';
 *
 * const array = await flowOf(1, 2, 3).do(collectArray());
 * console.log(array);
 * // Output:
 * // [1, 2, 3]
 * ```
 */
export const collectArray =
  <T>(options?: CancellableOptions): FlowCollector<Flow<T, unknown, undefined>, T[]> =>
  src => {
    const array: T[] = [];
    return src
      .eachValue(x => {
        array.push(x);
      }, options)
      .then(() => array);
  };

/**
 * Collects all values yielded by the flow into a Set, removing duplicates.
 *
 * @param options - Optional cancellation options
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { collectSet } from '@youngspe/async-flows/ops';
 *
 * const set = await flowOf(1, 2, 2, 3, 3, 3).do(collectSet());
 * console.log(Array.from(set));
 * // Output:
 * // [1, 2, 3]
 * ```
 */
export const collectSet =
  <T>(options?: CancellableOptions): FlowCollector<Flow<T, unknown, undefined>, Set<T>> =>
  src => {
    const out = new Set<T>();
    return src
      .eachValue(x => {
        out.add(x);
      }, options)
      .then(() => out);
  };

/**
 * Collects a flow of key-value pairs into a Map.
 *
 * @param options - Optional cancellation options
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { collectMap } from '@youngspe/async-flows/ops';
 *
 * const keyed = await flowOf<[string, number]>(['a', 1], ['b', 2], ['c', 3]).do(collectMap());
 * console.log(Array.from(keyed));
 * // Output:
 * // [['a', 1], ['b', 2], ['c', 3]]
 * ```
 */
export const collectMap =
  <K, V>(options?: CancellableOptions): FlowCollector<Flow<[K, V], unknown, undefined>, Map<K, V>> =>
  src => {
    const out = new Map<K, V>();
    return src
      .eachValue(([k, v]) => {
        out.set(k, v);
      }, options)
      .then(() => out);
  };

/**
 * Similar to {@link collectMap}, but instead of operating on key-value pairs, a function is called
 * to derive the key for each value.
 *
 * @param keyFn - Function that produces a key from each value
 * @param options - Optional cancellation options
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { associate } from '@youngspe/async-flows/ops';
 *
 * const indexed = await flowOf(10, 20, 30).do(associate(async n => `key-${n}`));
 * console.log(Array.from(indexed));
 * // Output:
 * // [['key-10', 10], ['key-20', 20], ['key-30', 30]]
 * ```
 */
export const associate =
  <K, V>(
    keyFn: (value: V) => Awaitable<K>,
    options?: CancellableOptions,
  ): FlowCollector<Flow<V, unknown, undefined>, Map<K, V>> =>
  src => {
    const out = new Map<K, V>();
    return src
      .eachValue(async v => {
        out.set(await keyFn(v), v);
      }, options)
      .then(() => out);
  };

/**
 * Collects values from a flow into the given collector, but only for values that match a predicate.
 * The first value that does **not** match the predicate becomes the resolved value immediately,
 * short-circuiting the flow.
 *
 * @param collector - The collector to apply to matching values
 * @param pred - A predicate function; matching values are collected, the first non-matching value short-circuits
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { collectIf, collectArray } from '@youngspe/async-flows/ops';
 *
 * const [evens, firstOdd] = await flowOf(2, 4, 6, 7, 8, 10).do(
 *   collectIf(collectArray<number>(), n => n % 2 === 0),
 * );
 * console.log(evens);  // [2, 4, 6]
 * console.log(firstOdd); // 7
 * ```
 */
export function collectIf<T, X, U extends T>(
  collector: FlowCollector<Flow<U, unknown, undefined>, X>,
  pred: (value: T) => value is U,
): FlowCollector<Flow<T, unknown, undefined>, X | Exclude<T, U>>;
export function collectIf<T, X>(
  collector: FlowCollector<Flow<T, unknown, undefined>, X>,
  pred: (value: T) => Awaitable<boolean | NonNullable<unknown> | null | undefined>,
): FlowCollector<Flow<T, unknown, undefined>, X | T>;
export function collectIf<T, X>(
  collector: FlowCollector<Flow<T, unknown, undefined>, X>,
  pred: (value: T) => Awaitable<boolean | NonNullable<unknown> | null | undefined>,
): FlowCollector<Flow<T, unknown, undefined>, X | T> {
  return src =>
    new Promise((resolve, reject) => {
      collector(
        src.transformEach(async ({ value, emit }) => {
          if (!(await pred(value))) {
            resolve(value);
            throw new CancellationError();
          }

          return emit(value);
        }),
      ).then(resolve, reject);
    });
}

/**
 * Observes the flow and discards all yielded values.
 * Resolves to the return value of the flow.
 */
export const drain =
  <TReturn = unknown>(
    options?: CancellableOptions,
  ): FlowCollector<Flow<unknown, TReturn, undefined>, TReturn> =>
  src =>
    src.each(() => undefined, options);

/**
 * Observes the flow, feeding yielded items back as input vales.
 * Resolves to the return value of the flow.
 */
export const feedback =
  <T extends TNext, TReturn = unknown, TNext = T>(
    options?: CancellableOptions,
  ): FlowCollector<Flow<T, TReturn, TNext>, TReturn> =>
  src =>
    src.eachValue(x => x, options);
