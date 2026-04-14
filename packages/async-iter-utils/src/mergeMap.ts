import type { Awaitable } from '@youngspe/async-scope-common';
import { whenAllSettled } from '@youngspe/common-async-utils';
import { channel, Receiver, Sender } from './mpmc.ts';
import type { MaybeAsyncIterableOrIterator } from './types.ts';
import { asyncIteratorFrom } from './utils.ts';

class MergeMapAsyncIter<T, U, TReturn> implements AsyncIterableIterator<U, TReturn, void> {
  #inner;
  #mapping;
  #readyIters: Map<AsyncIterator<U, unknown, undefined>, Sender<U>> | undefined = new Map();
  #allIters: Set<AsyncIterator<U, unknown, undefined>> | undefined = new Set();
  #sender: Sender<U, TReturn> | undefined;
  #receiver: Receiver<U, TReturn>;

  constructor(
    inner: AsyncIterator<T, TReturn, undefined> | undefined,
    mapping: ((value: T) => MaybeAsyncIterableOrIterator<U, unknown, void>) | undefined,
  ) {
    this.#inner = inner;
    this.#mapping = mapping;
    const { sender, receiver } = channel<U, TReturn>();

    this.#sender = sender;
    this.#receiver = receiver;
  }

  #cancelAll() {
    const readyIters = this.#readyIters;
    const allIters = this.#allIters;
    const inner = this.#inner;
    const sender = this.#sender;
    this.#readyIters = this.#allIters = this.#inner = this.#sender = undefined;

    const promises: Array<Promise<unknown> | undefined> = [];

    promises.push(
      inner?.return?.()?.then(
        undefined,
        sender
          && (() => {
            /* discard errors */
          }),
      ),
    );

    if (readyIters) {
      for (const iter of readyIters.keys()) {
        allIters?.delete(iter);
        promises.push(iter.return?.());
      }
    }

    if (allIters) {
      for (const iter of allIters) {
        promises.push(
          iter.return?.()?.then(undefined, () => {
            /* discard errors */
          }),
        );
      }
    }

    return whenAllSettled(promises);
  }

  async #mainIterLoop() {
    const inner = this.#inner;
    const sender = this.#sender;
    this.#sender = undefined;
    if (!inner || !sender?.isConnected) return;

    try {
      do {
        const result = await inner.next();

        if (result.done) {
          this.#inner = undefined;
          sender.close(result.value);
          return;
        }

        const iter = asyncIteratorFrom(
          this.#mapping ?
            this.#mapping(result.value)
          : (result.value as MaybeAsyncIterableOrIterator<U, unknown, undefined>),
        );

        this.#allIters?.add(iter);

        void this.#nestedIterLoop(iter, sender.clone());
      } while (sender.pendingReaderCount);
    } catch (error) {
      this.#inner = undefined;
      sender.abort(this.#cancelAll().then(() => error));
    }

    this.#sender = sender;
  }

  async #nestedIterLoop(iter: AsyncIterator<U, unknown, undefined>, sender: Sender<U>) {
    this.#readyIters?.delete(iter);

    if (!sender.isConnected) return;
    try {
      do {
        const result = await iter.next();

        if (result.done) {
          this.#allIters?.delete(iter);
          sender.close();
          return;
        }

        sender.send(result.value);
      } while (sender.pendingReaderCount);
    } catch (error) {
      this.#allIters?.delete(iter);
      sender.abort(this.#cancelAll().then(() => error));
    }

    this.#readyIters?.set(iter, sender);
  }

  async next(): Promise<IteratorResult<U, TReturn>> {
    const result = this.#receiver.tryNext();
    if (result) return result;

    if (this.#readyIters) {
      for (const [iter, sender] of this.#readyIters) {
        void this.#nestedIterLoop(iter, sender);
      }
    }
    void this.#mainIterLoop();

    return this.#receiver.next();
  }

  async return(value: Awaitable<TReturn>): Promise<IteratorResult<U, TReturn>> {
    this.#receiver.close();
    [value] = await Promise.all([value, this.#cancelAll()]);
    await this.#cancelAll();
    return { done: true, value } as IteratorResult<U, TReturn>;
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

export function mergeMapAsyncIterator<T, U, TReturn = void>(
  src: MaybeAsyncIterableOrIterator<T, TReturn, undefined>,
  mapping: (value: T) => MaybeAsyncIterableOrIterator<U, unknown, undefined>,
): AsyncIterableIterator<U, TReturn, void> {
  return new MergeMapAsyncIter(asyncIteratorFrom(src), mapping);
}

export function mergeAsyncIterator<T, TReturn = void>(
  src: MaybeAsyncIterableOrIterator<
    MaybeAsyncIterableOrIterator<T, unknown, undefined>,
    TReturn,
    undefined
  >,
): AsyncIterableIterator<T, TReturn, void> {
  return new MergeMapAsyncIter(asyncIteratorFrom(src), undefined);
}
