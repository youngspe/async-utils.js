import { Scope, Subscription, type ToScope, Token } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';
import {
  asyncIterableIteratorFrom,
  asyncIteratorFrom,
  throwingAsyncIterator,
  type MaybeAsyncIterableOrIterator,
} from '@youngspe/async-iter-utils';

class CancellableAsyncIterator<T, TReturn, TNext> implements AsyncIterableIterator<T, TReturn, TNext> {
  readonly #inner: AsyncIterator<T, TReturn, TNext>;
  readonly #token: Token;
  #sub: Subscription | undefined;

  constructor(inner: AsyncIterator<T, TReturn, TNext>, token: Token) {
    this.#inner = inner;
    this.#token = token;

    if (this.#inner.return) {
      this.#sub = token.add(async () => {
        await this.#inner.return?.();
      });
      this.return = function (value) {
        const sub = this.#sub;
        this.#sub = undefined;
        sub?.dispose();
        return (
          this.#inner.return?.(value)
          ?? Promise.resolve({ done: true, value } as IteratorReturnResult<TReturn>)
        );
      };
    }

    if (this.#inner.throw) {
      this.throw = function (error) {
        return this.#wrap(() => {
          if (!this.#inner.throw) throw error;
          return this.#inner.throw(error);
        });
      };
    }
  }

  async #wrap(action: () => Awaitable<IteratorResult<T, TReturn>>) {
    return Scope.from(this.#token).run(async () => {
      let out;
      try {
        out = await action();
      } catch (error) {
        const sub = this.#sub;
        this.#sub = undefined;
        sub?.dispose();
        throw error;
      }

      if (out.done) {
        const sub = this.#sub;
        this.#sub = undefined;
        sub?.dispose();
      }

      return out;
    }, this.#token);
  }

  next(...args: [value: TNext] | []) {
    return this.#wrap(() => this.#inner.next(...args));
  }

  return?(value?: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>>;
  throw?(e?: unknown): Promise<IteratorResult<T, TReturn>>;

  [Symbol.asyncIterator]() {
    return this;
  }
}

export function cancellableAsyncIterator<T, TReturn, TNext>(
  iter: MaybeAsyncIterableOrIterator<T, TReturn, TNext>,
  scope: ToScope,
): AsyncIterableIterator<T, TReturn, TNext> {
  const token = Token.from(scope);
  const { error } = token;

  if (error) return throwingAsyncIterator(error);

  if (token.isDefused) return asyncIterableIteratorFrom(iter);

  return new CancellableAsyncIterator(asyncIteratorFrom(iter), token);
}
