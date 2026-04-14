import type { Awaitable } from '@youngspe/async-scope-common';
import type { MaybeAsyncIterableOrIterator } from './types.ts';
import { asyncIteratorFrom } from './utils.ts';

class MapAsyncIter<T, U, TReturn, TNext> implements AsyncIterableIterator<U, TReturn, TNext> {
  readonly #inner;
  readonly #mapping;

  constructor(inner: AsyncIterator<T, TReturn, TNext>, mapping: (value: T) => Awaitable<U>) {
    this.#inner = inner;
    this.#mapping = mapping;
  }

  async #mapResult(result: IteratorResult<T, TReturn>): Promise<IteratorResult<U, TReturn>> {
    if (result.done) return result;

    const value = await this.#mapping(result.value);

    return { done: false, value };
  }

  next(...args: [] | [TNext]): Promise<IteratorResult<U, TReturn>> {
    return this.#inner.next(...args).then(result => this.#mapResult(result));
  }

  return(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<U, TReturn>> {
    if (!this.#inner.return) {
      return Promise.resolve({ done: true, value } as IteratorResult<never, TReturn>);
    }

    return this.#inner.return(value).then(result => this.#mapResult(result));
  }

  throw(e?: any): Promise<IteratorResult<U, TReturn>> {
    if (!this.#inner.throw) return Promise.reject(e);

    return this.#inner.throw(e).then(result => this.#mapResult(result));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<U, TReturn, TNext> {
    return this;
  }
}

export function mapAsyncIterator<T, U, TReturn = void, TNext = void>(
  src: MaybeAsyncIterableOrIterator<T, TReturn, TNext>,
  mapping: (value: T) => Awaitable<U>,
): AsyncIterableIterator<U, TReturn, TNext> {
  return new MapAsyncIter(asyncIteratorFrom(src), mapping);
}
