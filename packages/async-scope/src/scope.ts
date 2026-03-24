/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { CancellationError } from './error.ts';
import type { Awaitable, Falsy } from './types.ts';
import Symbols from './symbols.ts';
import { isArray, joinPromisesAggregatingErrors } from './utils.ts';

export interface CancellableParentHandle {
  remove(key: object): void;
  isValid(key: object): boolean;
}

export interface Cancellable {
  cancel(reason: Error): Awaitable<void>;
  /** Return false to prevent the parent from adding this cancellable. */
  [Symbols.cancellableAdded]?(handle: CancellableParentHandle): boolean | void;
  [Symbols.cancellableRemoved]?(handle: CancellableParentHandle): void;
}

export type CancellableLike =
  | Cancellable
  | Falsy
  | Disposable
  | AsyncDisposable
  | readonly CancellableLike[];
export type CancellationListener = (reason: unknown) => Awaitable<void>;

export async function cancelObject(target: CancellableOrDisposable, reason: Error) {
  if (typeof target.cancel === 'function') {
    await target.cancel(reason);
    return;
  }

  if (typeof target[Symbol.asyncDispose] === 'function') {
    await target[Symbol.asyncDispose]!();
    return;
  }

  if (typeof target[Symbol.dispose] === 'function') {
    target[Symbol.dispose]!();
    return;
  }
}

export function cancel(target: CancellableLike, reason?: Error): Promise<void>;
export async function cancel(
  target: CancellableLike,
  reason: Error = new CancellationError(),
): Promise<void> {
  if (!target) return;

  if (isArray(target)) {
    await joinPromisesAggregatingErrors(target.map(t => cancel(t, reason)));
    return;
  }

  return cancelObject(target, reason);
}

export interface CancellableOrDisposable
  extends Partial<Cancellable>, Partial<Disposable>, Partial<AsyncDisposable> {}

export abstract class CancellationSource {
  abstract get error(): Error | undefined;

  get isDefused() {
    return false;
  }

  get isCancelled() {
    return !!this.error;
  }

  protected abstract addOne(key: object, target: CancellableOrDisposable): boolean | void;
  protected abstract removeOne(key: object): void;

  add(...targets: (CancellableLike | CancellationListener)[]): boolean {
    if (this.isCancelled) return false;
    if (this.isDefused) return true;

    let out = true;

    for (let target of targets) {
      if (!target) continue;

      if (isArray(target)) {
        this.add(...target);
        continue;
      }

      const key: object = target;

      if (typeof target === 'function') {
        target = { cancel: target };
      }

      if (this.addOne(key, target) === false) {
        out = false;
      }
    }

    return out;
  }

  remove(...targets: (CancellableLike | CancellationListener)[]) {
    if (this.isCancelled || this.isDefused) return;

    for (const key of targets) {
      if (!key) continue;

      if (isArray(key)) {
        this.remove(...key);
        continue;
      }

      this.removeOne(key);
    }

    return true;
  }

  use<X extends CancellableLike>(target: X): X {
    const { error } = this;
    if (error) throw error;
    this.add(target);
    return target;
  }

  tryUse<X extends CancellableLike>(target: X): X | undefined {
    return this.add(target) ? target : undefined;
  }

  #signal: AbortSignal | undefined;

  get signal(): AbortSignal {
    if (this.#signal) return this.#signal;

    if (this.isDefused) {
      // When this is defused, generate a new AbortSignal so listeners that get added don't stick around
      return AbortSignal.any([]);
    }

    const { error } = this;

    if (error) return (this.#signal = AbortSignal.abort(error));

    const ac = new AbortController();

    const listener: Cancellable = {
      cancel: ac.abort.bind(ac),
      [Symbols.cancellableRemoved]: () => {
        // Discard the AbortSignal on defuse so we don't keep the event listeners.
        this.#signal = undefined;
      },
    };

    this.addOne(listener, listener);

    return (this.#signal = ac.signal);
  }
}

export abstract class Scope {
  #error: Error | undefined;

  get error(): Error | undefined {
    return this.#error;
  }

  get closed(): boolean {
    return !!this.#error;
  }

  throwIfClosed() {
    if (this.#error) throw this.#error;
  }

  use<T extends CancellableLike>(value: T): T {
    if (this.#error) throw this.#error;
    if (!value) return value;

    // TODO
    return value;
  }

  readonly scope: Scope = this;

  static from(scope: ToScope) {}
}

export type ToScope =
  | Scope
  | readonly ToScope[]
  | AbortSignal
  | { signal?: AbortSignal; scope?: ToScope }
  | Falsy;
