import { isAsyncIterable, isIterable, isPromiseLike } from '@youngspe/common-async-utils';

import type {
  MaybeAsyncIterableOrIterator,
  MaybeAsyncIterator,
  MaybeAsyncIteratorResult,
} from './types.ts';

function flattenMaybeAsyncIteratorResult<T, TReturn>(
  result: MaybeAsyncIteratorResult<T, TReturn>,
): PromiseLike<IteratorResult<T, TReturn>> {
  if (isPromiseLike(result)) return result;
  if (!isPromiseLike(result.value)) return Promise.resolve(result as IteratorResult<T, TReturn>);
  return result.value.then(value => ({ done: result.done, value }) as IteratorResult<T, TReturn>);
}

class AsyncIteratorFrom<T, TReturn, TNext> implements AsyncIterableIterator<T, TReturn, TNext> {
  #inner;

  constructor(inner: MaybeAsyncIterator<T, TReturn, TNext>) {
    this.#inner = inner;
  }

  next(...args: [] | [TNext]): Promise<IteratorResult<T, TReturn>> {
    try {
      return Promise.resolve(flattenMaybeAsyncIteratorResult(this.#inner.next(...args)));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>> {
    if (isPromiseLike(value)) return Promise.resolve(value.then(value => this.return(value)));
    if (!this.#inner.return) return Promise.resolve({ done: true, value } as IteratorResult<T, TReturn>);

    try {
      return Promise.resolve(flattenMaybeAsyncIteratorResult(this.#inner.return(value)));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  throw(error?: any): Promise<IteratorResult<T, TReturn>> {
    if (!this.#inner.throw) return Promise.reject(error);

    try {
      return Promise.resolve(flattenMaybeAsyncIteratorResult(this.#inner.throw(error)));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

export class ThrowAsyncIterator implements AsyncIterableIterator<never, never, unknown> {
  readonly #error;

  constructor(error: unknown) {
    this.#error = error;
  }

  next() {
    return Promise.reject(this.#error);
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

class EmptyAsyncIterator<TReturn> implements AsyncIterableIterator<never, TReturn, unknown> {
  readonly #value;

  constructor(value: TReturn) {
    this.#value = value;
  }

  next(): Promise<IteratorReturnResult<TReturn>> {
    return Promise.resolve({ value: this.#value, done: true });
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

export function asyncIteratorFrom<T, TReturn = unknown, TNext = void>(
  iterable: MaybeAsyncIterableOrIterator<T, TReturn, TNext>,
): AsyncIterator<T, TReturn, TNext> {
  try {
    if (isIterable(iterable)) return new AsyncIteratorFrom(iterable[Symbol.iterator]());
    if (isAsyncIterable(iterable)) {
      return iterable[Symbol.asyncIterator]();
    }

    return new AsyncIteratorFrom(iterable);
  } catch (error) {
    return new ThrowAsyncIterator(error);
  }
}

export function asyncIterableIteratorFrom<T, TReturn = unknown, TNext = void>(
  iterable: MaybeAsyncIterableOrIterator<T, TReturn, TNext>,
): AsyncIterableIterator<T, TReturn, TNext> {
  try {
    if (isIterable(iterable)) return new AsyncIteratorFrom(iterable[Symbol.iterator]());
    if (isAsyncIterable(iterable)) {
      const iterator = iterable[Symbol.asyncIterator]();

      if (isAsyncIterable(iterator)) return iterator as AsyncIterableIterator<T, TReturn, TNext>;
      return Object.assign(iterator, {
        [Symbol.asyncIterator]() {
          return this;
        },
      }) as AsyncIterableIterator<T, TReturn, TNext>;
    }

    return new AsyncIteratorFrom(iterable);
  } catch (error) {
    return new ThrowAsyncIterator(error);
  }
}

export function throwingAsyncIterator(error: unknown): AsyncIterableIterator<never, never, unknown> {
  return new ThrowAsyncIterator(error);
}

const EMPTY: AsyncIterableIterator<never, undefined, unknown> = Object.freeze(
  new EmptyAsyncIterator(undefined),
);

export function emptyAsyncIterator(): AsyncIterableIterator<never, void, unknown>;
export function emptyAsyncIterator<TReturn>(
  returnValue: TReturn,
): AsyncIterableIterator<never, TReturn, unknown>;
export function emptyAsyncIterator<TReturn>(
  returnValue?: TReturn,
): AsyncIterableIterator<never, TReturn, unknown> {
  if (returnValue === undefined) return EMPTY as AsyncIterableIterator<never, TReturn, unknown>;
  return new EmptyAsyncIterator(returnValue);
}
