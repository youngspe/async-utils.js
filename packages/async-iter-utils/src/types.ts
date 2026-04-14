import type { Awaitable } from '@youngspe/async-scope-common';

export type MaybeAsyncIterator<T, TReturn, TNext> =
  | AsyncIterator<T, TReturn, TNext>
  | Iterator<Awaitable<T>, Awaitable<TReturn>, TNext>;

export type MaybeAsyncIterable<T, TReturn, TNext> =
  | AsyncIterable<T, TReturn, TNext>
  | Iterable<Awaitable<T>, Awaitable<TReturn>, TNext>;

export type MaybeAsyncIterableOrIterator<T, TReturn, TNext> =
  | MaybeAsyncIterable<T, TReturn, TNext>
  | MaybeAsyncIterator<T, TReturn, TNext>;

export type MaybeAsyncIteratorResult<T, TReturn> =
  | IteratorResult<Awaitable<T>, Awaitable<TReturn>>
  | PromiseLike<IteratorResult<T, TReturn>>;
