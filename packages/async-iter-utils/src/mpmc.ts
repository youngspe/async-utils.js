import { isPromiseLike, type OrNever } from '@youngspe/common-async-utils';
import { ThrowAsyncIterator } from './utils.ts';
import type { CancellationTokenBase } from '@youngspe/async-scope-common';

interface SenderState<T, TClose> {
  refs: number;
  waiters:
    | Map<
        object,
        { resolve: (result: IteratorResult<T, TClose>) => void; reject: (reason: unknown) => void }
      >
    | undefined;
}

interface ReceiverState<T, TClose> {
  refs: number;
  ret?: TClose;
  error?: unknown;
  buf: T[] | undefined;
}

export abstract class Sender<in T, in TClose = void> {
  abstract get isClosed(): boolean;
  abstract get isConnected(): boolean;
  abstract send(value: T): boolean;
  abstract clone<TClose2 extends TClose | void = TClose>(): Sender<T, TClose2>;
  abstract close(value: TClose): void;
  abstract get pendingReaderCount(): number;
  abstract abort(reason?: unknown): void;
  [Symbol.dispose](value: TClose) {
    this.close(value);
  }
}

export abstract class Receiver<out T, out TClose = void> implements AsyncIterable<T, TClose, unknown> {
  abstract get isClosed(): boolean;
  receive(): Promise<T | OrNever<TClose, undefined>>;
  async receive(options?: { token?: CancellationTokenBase | undefined }): Promise<T | undefined> {
    return this.next(options).then(result => (result.done ? undefined : result.value));
  }
  tryReceive(): T | undefined {
    const result = this.tryNext();

    return result?.done ? undefined : result?.value;
  }
  abstract next(options?: {
    token?: CancellationTokenBase | undefined;
  }): Promise<IteratorResult<T, TClose>>;
  tryNext(): IteratorResult<T, TClose> | undefined {
    return undefined;
  }
  abstract clone(): Receiver<T, TClose>;
  abstract close(): void;

  queuedValues(): IterableIterator<T, TClose | undefined, void> {
    const receiver = this.clone();

    return {
      next: () => receiver.tryNext() ?? { done: true, value: undefined },
      return: value => {
        receiver.close();
        return { done: true, value };
      },
      [Symbol.iterator]() {
        return this;
      },
    };
  }

  #intoIter(token?: CancellationTokenBase): AsyncIterableIterator<T, TClose, unknown> {
    const sub = token?.add(() => {
      this.close();
    });
    const _options = { token };

    return {
      next: () => this.next(_options),
      return: async value => {
        try {
          sub?.[Symbol.dispose]();
          value = await value;
        } finally {
          this.close();
        }
        return { done: true, value } as IteratorResult<T, TClose>;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  values(options?: {
    token?: CancellationTokenBase | undefined;
  }): AsyncIterableIterator<T, TClose, unknown> {
    if (options?.token?.error) return new ThrowAsyncIterator(options?.token?.error);
    return this.clone().#intoIter(options?.token);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T, TClose, unknown> {
    return this.#intoIter();
  }

  [Symbol.dispose]() {
    this.close();
  }
}

export interface Channel<in out T, in out TClose = void> {
  sender: Sender<T, TClose>;
  receiver: Receiver<T, TClose>;
}

class MpmcSender<T, TClose> extends Sender<T, TClose> {
  #senderState;
  #receiverState;

  constructor(
    senderState: SenderState<T, TClose> | undefined,
    receiverState: WeakRef<ReceiverState<T, TClose>> | undefined,
  ) {
    super();
    this.#senderState = senderState;
    this.#receiverState = receiverState;
  }

  override get isClosed(): boolean {
    return !this.#senderState;
  }

  override get isConnected(): boolean {
    return !!this.#senderState?.waiters && !!this.#receiverState?.deref()?.buf;
  }

  override get pendingReaderCount() {
    return this.#senderState?.waiters?.size ?? 0;
  }

  override send(value: T): boolean {
    if (!this.#senderState) {
      throw new TypeError('Called send() on closed sender');
    }
    const waiters = this.#senderState.waiters;

    if (!waiters) return false;

    const [pair] = waiters;

    if (pair) {
      const [key, w] = pair;
      waiters.delete(key);
      w.resolve({ done: false, value });

      return true;
    }

    const receiverState = this.#receiverState?.deref();

    if (!receiverState?.buf) return false;

    receiverState.buf.push(value);
    return true;
  }

  override clone<TClose2 extends TClose | void>(): MpmcSender<T, TClose2> {
    const newSender = new MpmcSender(this.#senderState, this.#receiverState);

    if (this.#senderState) {
      this.#senderState.refs += 1;
    }

    return newSender as MpmcSender<T, TClose2 | TClose> as MpmcSender<T, TClose2>;
  }
  override close(value: TClose): void {
    const senderState = this.#senderState;
    const weakReceiverState = this.#receiverState;
    this.#senderState = this.#receiverState = undefined;

    if (!senderState?.waiters) return;

    const receiverState = weakReceiverState?.deref();

    if (receiverState) {
      if (value !== undefined) {
        receiverState.ret = value;
      } else if ('ret' in receiverState) {
        value = receiverState.ret;
      }
    }

    if (--senderState.refs !== 0) return;
    const { waiters } = senderState;
    senderState.waiters = undefined;

    for (const w of waiters.values()) {
      w.resolve({ done: true, value });
    }
  }
  override abort(reason?: unknown): void {
    const senderState = this.#senderState;
    if (!senderState?.waiters) return;
    const { waiters } = senderState;
    senderState.waiters = undefined;

    const receiverState = this.#receiverState?.deref();
    this.#receiverState = undefined;

    if (!receiverState?.buf) return;

    for (const w of waiters.values()) {
      w.reject(reason);
    }

    receiverState.buf = undefined;
    delete receiverState.ret;
    receiverState.error = reason;
  }
}

export class MpmcReceiver<T, TClose> extends Receiver<T, TClose> {
  #senderState;
  #receiverState;

  constructor(
    senderState: WeakRef<SenderState<T, TClose>> | undefined,
    receiverState: ReceiverState<T, TClose> | undefined,
  ) {
    super();
    this.#senderState = senderState;
    this.#receiverState = receiverState;
  }

  override get isClosed() {
    return !this.#receiverState;
  }

  override next(options?: {
    token?: CancellationTokenBase | undefined;
  }): Promise<IteratorResult<T, TClose>> {
    return new Promise((resolve, reject) => {
      if (!this.#receiverState) throw new TypeError('Called next() on closed receiver');
      if ('error' in this.#receiverState) {
        const { error } = this.#receiverState;
        if (isPromiseLike(error)) {
          error.then(reject);
          return;
        }

        throw error;
      }

      const token = options?.token;
      const tokenError = token?.error;
      if (tokenError) throw tokenError;

      const { buf } = this.#receiverState;
      if (!buf) return resolve({ done: true, value: this.#receiverState.ret! });
      if (buf.length) return resolve({ done: false, value: buf.shift()! });

      const senderState = this.#senderState;

      const key: object = {};
      const sub = token?.add(e => {
        senderState?.deref()?.waiters?.delete(key);
        reject(e);
      });

      senderState?.deref()?.waiters?.set(
        key,
        sub?.isActive ?
          {
            resolve: result => {
              try {
                sub[Symbol.dispose]();
                resolve(result);
              } catch (error) {
                reject(error);
              }
            },
            reject: error => {
              sub[Symbol.dispose]();
              reject(error);
            },
          }
        : { resolve, reject },
      );
    });
  }

  override tryNext(): IteratorResult<T, TClose> | undefined {
    if (!this.#receiverState) return undefined;

    if ('error' in this.#receiverState) {
      const { error } = this.#receiverState;

      if (isPromiseLike(error)) return undefined;
      throw error;
    }
    const { buf } = this.#receiverState;
    if (!buf) return { done: true, value: this.#receiverState.ret! };
    if (buf.length) return { done: false, value: buf.shift()! };

    return undefined;
  }

  override clone() {
    const newReceiver = new MpmcReceiver(this.#senderState, this.#receiverState);

    if (this.#receiverState) {
      ++this.#receiverState.refs;
    }

    return newReceiver;
  }

  override close() {
    const receiverState = this.#receiverState;
    this.#senderState = this.#receiverState = undefined;

    if (!receiverState || --receiverState.refs !== 0) return;

    receiverState.buf = undefined;
    delete receiverState.ret;
  }
}

export function channel<T, TClose = void>(): Channel<T, TClose> {
  const senderState: SenderState<T, TClose> = { refs: 1, waiters: new Map() };
  const receiverState: ReceiverState<T, TClose> = { refs: 0, buf: undefined };

  return {
    sender: new MpmcSender(senderState, new WeakRef(receiverState)),
    receiver: new MpmcReceiver(new WeakRef(senderState), receiverState),
  };
}
