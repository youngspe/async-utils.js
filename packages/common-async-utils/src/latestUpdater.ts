import type { Awaitable } from './types.ts';

export interface LatestUpdater<in A extends any[] = [value?: unknown], out Ret = unknown> {
  readonly update: (this: void, ...args: A) => Promise<Ret>;
}

class DefaultLatestUpdater<A extends any[], Ret> implements LatestUpdater<A, Ret> {
  #promise: Promise<Ret> | undefined;
  #pendingUpdate: { args: A } | undefined;
  #onUpdate: (this: void, ...args: A) => Awaitable<Ret>;

  constructor(onUpdate: (this: void, ...args: A) => Awaitable<Ret>) {
    this.#onUpdate = onUpdate;
  }

  #update(args: A): Promise<Ret> {
    try {
      return Promise.resolve(this.#onUpdate(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  readonly update = (...args: A): Promise<Ret> => {
    const oldPromise = this.#promise;

    if (!oldPromise) {
      const newPromise = (this.#promise = this.#update(args).finally(() => {
        if (this.#promise === newPromise) {
          this.#promise = undefined;
        }
      }));

      return newPromise;
    }

    const pendingUpdate = this.#pendingUpdate;

    if (pendingUpdate) {
      pendingUpdate.args = args;
      return oldPromise;
    }

    const newPendingUpdate = { args };

    const newPromise = (this.#promise = oldPromise
      .catch(() => undefined)
      .then(() => {
        this.#pendingUpdate = undefined;
        const newArgs = newPendingUpdate.args;
        return this.#update(newArgs);
      })
      .finally(() => {
        if (this.#promise === newPromise) {
          this.#promise = undefined;
        }
      }));

    return newPromise;
  };
}

export function latestUpdater<A extends any[] = [value?: unknown], Ret = void>(
  onUpdate: (this: void, ...args: A) => Awaitable<Ret>,
): LatestUpdater<A, Ret> {
  return new DefaultLatestUpdater(onUpdate);
}
