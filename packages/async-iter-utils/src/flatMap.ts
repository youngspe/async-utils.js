import type { Awaitable } from '@youngspe/async-scope-common';

import type { MaybeAsyncIterableOrIterator } from './types.ts';
import { asyncIteratorFrom } from './utils.ts';

class FlatMapAsyncIter<T, U, TReturn, TMid, TNext> implements AsyncIterableIterator<U, TReturn, TNext> {
  #inner;
  #mapping;

  #nestedIter: AsyncIterator<U, TMid, TNext> | undefined;

  constructor(
    inner: AsyncIterator<T, TReturn, TMid>,
    mapping: ((value: T) => Awaitable<MaybeAsyncIterableOrIterator<U, TMid, TNext>>) | undefined,
  ) {
    this.#inner = inner;
    this.#mapping = mapping;
  }

  async #mapResult(result: IteratorResult<T, TReturn>) {
    if (result.done) return result;

    const iterable =
      this.#mapping ?
        await this.#mapping(result.value)
      : (result.value as MaybeAsyncIterableOrIterator<U, TMid, TNext>);

    const value = (this.#nestedIter = asyncIteratorFrom(iterable));

    return { done: false, value } as const;
  }

  async #handleError(error: unknown) {
    if (!this.#inner.throw) throw error;

    while (true) {
      const nextResult = await this.#inner.throw(error);
      try {
        return await this.#mapResult(nextResult);
      } catch (e) {
        error = e;
      }
    }
  }

  async #loop(nestedResult: IteratorResult<U, TMid>): Promise<IteratorResult<U, TReturn>> {
    while (true) {
      if (!nestedResult.done) return nestedResult;

      const innerResult = await this.#inner.next(nestedResult.value);

      let result;

      try {
        result = await this.#mapResult(innerResult);
      } catch (error) {
        result = await this.#handleError(error);
      }

      const _result = await this.#nextNested(result);

      if (_result.done) return _result;
      nestedResult = _result.value;
    }
  }

  async #nextNested(result: IteratorResult<AsyncIterator<U, TMid, TNext>, TReturn>) {
    while (true) {
      if (result.done) return result;

      try {
        return { done: false, value: await result.value.next() } as const;
      } catch (error) {
        result = await this.#handleError(error);
      }
    }
  }

  async next(...args: [] | [TNext]): Promise<IteratorResult<U, TReturn>> {
    let nestedIter = this.#nestedIter;

    if (!nestedIter) {
      const result = await this.#mapResult(await this.#inner.next());
      if (result.done) return result;
      nestedIter = result.value;
    }

    let nestedResult;

    try {
      nestedResult = await nestedIter.next(...args);
    } catch (error) {
      const _result = await this.#nextNested(await this.#handleError(error));
      if (_result.done) return _result;
      nestedResult = _result.value;
    }

    return this.#loop(nestedResult);
  }
  async return(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<never, TReturn>> {
    let result;
    try {
      await this.#nestedIter?.return?.();
    } catch (error) {
      if (!this.#inner.throw) throw error;
      await this.#inner.throw(error);
    } finally {
      result = await this.#inner.return?.(value);
    }

    return result?.done ? result : ({ done: true, value: undefined } as IteratorResult<never, TReturn>);
  }
  async throw(error?: any): Promise<IteratorResult<U, TReturn>> {
    let result;

    if (this.#nestedIter?.throw) {
      try {
        const nestedResult = await this.#nestedIter.throw(error);
        return this.#loop(nestedResult);
      } catch (error) {
        result = await this.#handleError(error);
      }
    } else {
      result = await this.#handleError(error);
    }

    const _result = await this.#nextNested(result);

    if (_result.done) return _result;

    return this.#loop(_result.value);
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

export function flattenAsyncIterator<T, TReturn = void, TMid = void, TNext = void>(
  src: MaybeAsyncIterableOrIterator<MaybeAsyncIterableOrIterator<T, TMid, TNext>, TReturn, TMid>,
): AsyncIterableIterator<T, TReturn, TNext> {
  return new FlatMapAsyncIter(asyncIteratorFrom(src), undefined);
}

export function flatMapAsyncIterator<T, U, TReturn = void, TMid = void, TNext = void>(
  src: MaybeAsyncIterableOrIterator<T, TReturn, TMid>,
  mapping: (value: T) => Awaitable<MaybeAsyncIterableOrIterator<U, TMid, TNext>>,
): AsyncIterableIterator<U, TReturn, TNext> {
  return new FlatMapAsyncIter(asyncIteratorFrom(src), mapping);
}
