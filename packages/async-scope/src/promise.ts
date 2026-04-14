import { isPromiseLike } from '@youngspe/common-async-utils';
import type { ToScope } from './scope.ts';
import { Token } from './token.ts';
import type { Awaitable } from './types.ts';

function cancellablePromiseInternal<T>(promise: Awaitable<T>, token: Token): Promise<T> {
  if (!isPromiseLike(promise)) return Promise.resolve(promise);

  return new Promise((resolve, reject) => {
    const sub = token.add(reject);

    promise.then(
      x => {
        sub?.dispose();
        resolve(x);
      },
      e => {
        sub?.dispose();
        reject(e);
      },
    );
  });
}

export function cancellablePromise<T>(promise: Awaitable<T>, scope: ToScope) {
  const token = Token.from(scope);
  const { error } = token;

  if (error) return Promise.reject(error);

  return cancellablePromiseInternal(promise, token);
}

export function runOrCancel<T>(fn: () => Awaitable<T>, scope: ToScope): Promise<T> {
  const token = Token.from(scope);
  const { error } = token;

  if (error) return Promise.reject(error);

  let promise;

  try {
    promise = fn();
  } catch (error) {
    return Promise.reject(error);
  }

  return cancellablePromiseInternal(promise, token);
}
