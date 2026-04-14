import type { Awaitable } from '@youngspe/async-scope-common';
import { CancellationError, type CancellableOptions } from '@youngspe/async-scope';

import type { Flow } from '../../flow.ts';
import type { FlowCollector } from './module.ts';

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

export const drain =
  <TReturn = unknown>(): FlowCollector<Flow<unknown, TReturn, undefined>, TReturn> =>
  src =>
    src.each(() => undefined);
