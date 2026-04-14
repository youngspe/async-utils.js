import type { CancellableOptions } from './cancel.ts';
import { Token } from './token.ts';
import type { OptionalUndefinedParams } from './types.ts';

export interface SharedGuard<out T> extends Disposable {
  get value(): T;
  release(): void;
}

export interface Guard<in out T> extends SharedGuard<T> {
  set value(value: T);
}

type Waiter<T> =
  | { kind: 'read'; resolve: (guard: SharedGuard<T>) => void; token: Token | undefined }
  | { kind: 'write'; resolve: (guard: Guard<T>) => void; token: Token | undefined };

class RawLock<T> {
  #value: T;
  /** If positive, locked for reading. If negative, locked for writing. */
  #count = 0;

  #queue: Waiter<T>[] = [];

  constructor(value: T) {
    this.#value = value;
  }

  createReadGuard(token?: Token): SharedGuard<T> {
    let raw: this | undefined = this;

    if (token?.isCancelled) {
      raw = undefined;
    }

    const release = () => {
      const _raw = raw;
      sub?.dispose();
      sub = raw = undefined;
      _raw?.releaseReader();
    };

    let sub = token?.add(release);

    return {
      get value() {
        if (!raw) throw new TypeError('Cannot read from released guard');
        return raw.#value;
      },
      release,
      [Symbol.dispose]: release,
    };
  }

  createWriteGuard(token?: Token): Guard<T> {
    let raw: this | undefined = this;

    if (token?.isCancelled) {
      raw = undefined;
    }

    const release = () => {
      const _raw = raw;
      sub?.dispose();
      sub = raw = undefined;
      _raw?.releaseWriter();
    };

    let sub = token?.add(release);

    return {
      get value() {
        if (!raw) throw new TypeError('Cannot read from released guard');
        return raw.#value;
      },
      set value(value: T) {
        if (!raw) throw new TypeError('Cannot write to released guard');
        raw.#value = value;
      },
      release,
      [Symbol.dispose]: release,
    };
  }

  releaseReader() {
    if (this.#count === 0) throw new TypeError('Cannot release reader lock when no readers are held');
    if (this.#count < 0) throw new TypeError('Cannot release reader lock when it is locked for writing');

    if (this.#count > 1) {
      --this.#count;
      return;
    }

    const waiter = this.#queue.shift();

    if (!waiter) {
      this.#count = 0;
      return;
    }

    this.#count = 1;
    waiter.resolve(this.createReadGuard(waiter.token));
  }

  #getQueuedReaders() {
    let readerCount = 0;
    for (const waiter of this.#queue) {
      if (waiter.kind !== 'read') break;
      ++readerCount;
    }

    if (readerCount === 0) return;

    return this.#queue.splice(0, readerCount);
  }

  releaseWriter() {
    if (this.#count === 0) throw new TypeError('Cannot release writer lock when no writers are held');
    if (this.#count > 0) throw new TypeError('Cannot release writer lock when it is locked for reading');

    const readers = this.#getQueuedReaders();

    if (readers) {
      this.#count = readers.length;
      for (const r of readers) {
        r.resolve(this.createReadGuard(r.token));
      }
      return;
    }

    const waiter = this.#queue.shift();
    if (!waiter) {
      this.#count = 0;
      return;
    }

    if (waiter.kind === 'write') {
      waiter.resolve(this.createWriteGuard(waiter.token));
      return;
    }
  }

  tryAcquireReader(token?: Token): SharedGuard<T> | undefined {
    // don't acquire if there is anything in the queue because as long as the queue is not empty, it
    // must have at least one writer
    if (token?.isCancelled || this.#count < 0 || this.#queue.length) return undefined;
    ++this.#count;
    return this.createReadGuard(token);
  }

  tryAcquireWriter(token?: Token): SharedGuard<T> | undefined {
    if (token?.isCancelled || this.#count !== 0) return undefined;
    this.#count = -1;
    return this.createWriteGuard(token);
  }

  #removeWaiter(waiter: Waiter<T>) {
    const index = this.#queue.indexOf(waiter);
    if (index < 0) return;
    this.#queue.splice(index, 1);

    if (index === 0 && this.#count > 0 && waiter.kind === 'write') {
      const readers = this.#getQueuedReaders();

      if (readers) {
        this.#count += readers.length;
        for (const r of readers) {
          r.resolve(this.createReadGuard(r.token));
        }
      }
    }
  }

  async acquireReaderAsync(token?: Token): Promise<SharedGuard<T>> {
    token?.throwIfCancelled();

    const guard = this.tryAcquireReader(token);
    if (guard) return guard;

    return new Promise<SharedGuard<T>>((resolve, reject) => {
      const waiter: Waiter<T> = {
        kind: 'read',
        resolve: x => {
          sub?.dispose();
          resolve(x);
        },
        token,
      };
      const sub = token?.add(e => {
        this.#removeWaiter(waiter);
        reject(e);
      });
      this.#queue.push(waiter);
    });
  }

  async acquireWriterAsync(token?: Token): Promise<Guard<T>> {
    token?.throwIfCancelled();

    const guard = this.tryAcquireWriter(token);
    if (guard) return guard;

    return new Promise<Guard<T>>((resolve, reject) => {
      const waiter: Waiter<T> = {
        kind: 'write',
        resolve: x => {
          sub?.dispose();
          resolve(x);
        },
        token,
      };
      const sub = token?.add(e => {
        this.#removeWaiter(waiter);
        reject(e);
      });
      this.#queue.push(waiter);
    });
  }
}

export class Lock<T = void> {
  #raw;
  constructor(...[value]: OptionalUndefinedParams<[value: T]>) {
    this.#raw = new RawLock<T>(value as T);
  }

  acquireShared(options?: CancellableOptions): Promise<SharedGuard<T>> {
    return this.#raw.acquireReaderAsync(options && Token.from(options));
  }

  acquire(options?: CancellableOptions): Promise<Guard<T>> {
    return this.#raw.acquireWriterAsync(options && Token.from(options));
  }

  tryAcquireShared(options?: CancellableOptions): SharedGuard<T> | undefined {
    return this.#raw.tryAcquireReader(options && Token.from(options));
  }

  tryAcquire(options?: CancellableOptions): Guard<T> | undefined {
    return this.#raw.tryAcquireWriter(options && Token.from(options));
  }
}
