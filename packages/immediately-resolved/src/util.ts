import type { Awaitable } from './types.ts';

export function isPromiseLike<T>(value: Awaitable<T>): value is PromiseLike<T> {
  return (
    value instanceof Promise
    || (value !== null
      && (typeof value === 'object' || typeof value === 'function')
      && typeof (value as { then?: unknown }).then === 'function')
  );
}

export function isIterable<T = unknown, Ret = undefined, In = any, U = {} | null | undefined>(
  value: U | Iterable<T, Ret, In>,
): value is Iterable<T, Ret, In> {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

export type MaybeWeakRef<T> = { deref(): T | undefined };

export const MaybeWeakRef =
  'WeakRef' in globalThis ?
    (globalThis.WeakRef as unknown as new <T>(value: T) => MaybeWeakRef<T>)
  : class Ref<T> {
      readonly value: T | undefined;

      constructor(value: T) {
        this.value = value;
      }

      deref(): T | undefined {
        return this.value;
      }
    };
