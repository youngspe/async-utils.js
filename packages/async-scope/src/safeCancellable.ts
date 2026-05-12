import { isArray, joinPromises } from '@youngspe/common-async-utils';
import {
  tryCancelObjectSync,
  type Cancellable,
  type CancellableLike,
  type CancellableOrDisposable,
  type CancellableParent,
  type CancellationListener,
} from './cancel.ts';
import {
  CancellationError,
  combineErrors,
  toErrorForCancellation,
  unwrapCancellationError,
} from './error.ts';
import { Subscription, Symbols, type AddCancellableOptions } from './index.ts';

/**
 * Symbols for members that reach into {@link SafeCancellable} internals for optimization.
 */
namespace _symbols {
  /**
   * If this property is `true`, the cancellable will do nothing on cancellation and can
   * be discarded.
   */
  export const isDefused = Symbol('isDefused');
  /**
   * Returns a simplified version of the cancellable if available, otherwise returns itself.
   */
  export const simplify = Symbol('simplify');
  /**
   * If the cancellable is an aggregate over multiple cancellables, adds them to the given set.
   * Otherwise, adds itself to the given set if it is not defused.
   */
  export const expandToSet = Symbol('expandToSet');
}

/**
 * A {@link Cancellable} implementation with a normalized interface.
 * It is guaranteed that cancelling more than once has no effect.
 */
export abstract class SafeCancellable implements Cancellable, AsyncDisposable {
  abstract tryCancelSync(reason?: unknown): PromiseLike<undefined> | undefined;
  [_symbols.isDefused]?: boolean;
  [_symbols.expandToSet](destination: { add(value: SafeCancellable): unknown }) {
    const value = this[_symbols.simplify]();
    if (!value[_symbols.isDefused]) {
      destination.add(value);
    }
  }
  [_symbols.simplify](): SafeCancellable {
    return this[_symbols.isDefused] ? NOOP_CANCELLABLE : this;
  }

  cancel(reason: unknown = new CancellationError()): Promise<undefined> {
    try {
      return Promise.resolve(this.tryCancelSync(reason));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  [Symbols.cancellableAdding]?(
    key?: CancellableParent,
    options?: AddCancellableOptions,
  ): boolean | Subscription | void;

  [Symbols.cancellableAdded]?(
    key: CancellableParent,
    sub: Subscription,
    options?: AddCancellableOptions,
  ): boolean | Subscription | void;

  [Symbols.cancellableRemoved]?(key: CancellableParent): void;

  [Symbol.asyncDispose]() {
    return this.cancel(new CancellationError());
  }

  /** Flattens a {@link CancellableLike} into a set of cancellables and listeners. */
  static #flatten(src: CancellableLike<CancellationListener>) {
    const out = new Set<CancellableOrDisposable | CancellationListener>();

    const inner = (item: CancellableLike<CancellationListener>) => {
      if (!item) return;

      if (isArray(item)) {
        item.forEach(inner);
        return;
      }

      if (item instanceof SafeCancellable) {
        const simple = item[_symbols.simplify]();
        if (!simple[_symbols.isDefused]) {
          out.add(simple);
        }
        return;
      }

      out.add(item);
    };

    inner(src);

    return out;
  }

  /** Expands a list of cancellables and listeners into a set of {@link SafeCancellable}s. */
  static #expandAll(items: Iterable<CancellableOrDisposable | CancellationListener>) {
    const out = new Set<SafeCancellable>();

    for (const item of items) {
      if (item instanceof SafeCancellable) {
        item[_symbols.expandToSet](out);
        continue;
      }

      out.add(new WrappedCancellable(typeof item === 'function' ? { cancel: item } : item));
    }

    return out;
  }

  /** Converts a {@link CancellableLike} to a {@link SafeCancellable}. */
  static from(this: void, src: CancellableLike<CancellationListener>): SafeCancellable {
    if (!src) return NOOP_CANCELLABLE;
    if (src instanceof SafeCancellable) return src[_symbols.simplify]();

    const flattened = SafeCancellable.#flatten(src);

    if (flattened.size <= 1) {
      const [first] = flattened;

      if (!first) return NOOP_CANCELLABLE;
      if (first instanceof SafeCancellable) return first;

      return new WrappedCancellable(typeof first === 'function' ? { cancel: first } : first);
    }

    const expanded = SafeCancellable.#expandAll(flattened);

    let [out = NOOP_CANCELLABLE] = expanded;

    if (expanded.size > 1) {
      out = new AggregateCancellable(expanded);
    }

    return out;
  }

  /** Converts a {@link CancellableLike} to an array of {@link SafeCancellable}s. */
  static arrayFrom(this: void, src: CancellableLike<CancellationListener>): SafeCancellable[] {
    if (!src) return [];

    const flattened = SafeCancellable.#flatten(src);
    const expanded = SafeCancellable.#expandAll(flattened);

    return Array.from(expanded);
  }
}

export namespace SafeCancellable {
  export import symbols = _symbols;
}

/** Cancellable that does nothing. */
class NoopCancellable extends SafeCancellable {
  override [_symbols.expandToSet]() {}
  override [_symbols.simplify]() {
    return this;
  }

  override cancel() {
    return Promise.resolve(undefined);
  }
  override tryCancelSync(): undefined {}

  override [Symbols.cancellableAdding]() {
    return false;
  }

  override [Symbols.cancellableAdded]() {
    return false;
  }
}

const NOOP_CANCELLABLE = new NoopCancellable();

/**
 * Cancellable that safely wraps another cancellable, ensuring the underlying value is not cancelled
 * more than once.
 */
class WrappedCancellable extends SafeCancellable {
  #inner: CancellableOrDisposable | undefined;
  #promise: PromiseLike<undefined> | undefined;
  #parents: Map<CancellableParent, Subscription> | undefined = new Map();

  constructor(inner: CancellableOrDisposable) {
    super();
    this.#inner = inner;
  }

  #detach() {
    const parents = this.#parents;
    if (!parents) return;
    this.#parents = undefined;
    this[_symbols.isDefused] = true;

    for (const sub of parents.values()) {
      sub.dispose();
    }
  }

  override tryCancelSync(reason: unknown = new CancellationError()): PromiseLike<undefined> | undefined {
    if (this.#promise) return this.#promise;
    const inner = this.#inner;
    if (!inner) return;
    this.#inner = undefined;

    let p;
    try {
      p = tryCancelObjectSync(inner, toErrorForCancellation(reason))?.then(
        (): undefined => {
          this.#promise = undefined;
          this.#detach();
        },
        (e: unknown): undefined => {
          this.#promise = undefined;
          this.#detach();
          if (!unwrapCancellationError(e)) {
            throw e;
          }
        },
      );
    } catch (e) {
      this.#detach();
      if (!unwrapCancellationError(e)) {
        throw e;
      }
    }

    if (!p) {
      this.#detach();
    }

    return (this.#promise = p);
  }

  override [Symbols.cancellableAdding](key?: CancellableParent, options?: AddCancellableOptions) {
    const inner = this.#inner;
    if (!inner && !this.#promise) return false;
    if (key && this.#parents?.has(key)) {
      const ret = inner?.[Symbols.cancellableAdding]?.(key, options);
      if (ret instanceof Subscription) return ret;
      return false;
    }

    return inner?.[Symbols.cancellableAdding]?.(key, options);
  }

  override [Symbols.cancellableAdded](
    key: CancellableParent,
    sub: Subscription,
    options?: AddCancellableOptions,
  ) {
    const inner = this.#inner;
    if (!inner && !this.#promise) return false;

    if (this.#parents?.has(key)) {
      const ret = inner?.[Symbols.cancellableAdded]?.(key, sub, options);
      if (ret instanceof Subscription) return ret;
      return false;
    }

    this.#parents?.set(key, sub);
    return inner?.[Symbols.cancellableAdded]?.(key, sub, options);
  }

  override [Symbols.cancellableRemoved](key: CancellableParent) {
    this.#parents?.delete(key);
    return this.#inner?.[Symbols.cancellableRemoved]?.(key);
  }
}

/** A cancellable that forwards the cancellation to a set of cancellables. */
class AggregateCancellable extends SafeCancellable {
  #items: Set<SafeCancellable> | undefined;
  #promise: PromiseLike<undefined> | undefined;

  constructor(items: Set<SafeCancellable>) {
    super();
    this.#items = items;
  }

  override [_symbols.expandToSet](dest: { add(value: SafeCancellable): unknown }) {
    const items = this.#items;

    if (!items?.size) return;

    for (const item of items) {
      if (item[_symbols.isDefused]) {
        items.delete(item);
        continue;
      }
      dest.add(item);
    }

    if (items.size === 0) {
      this.#items = undefined;
      this[_symbols.isDefused] = true;
    }
  }

  override [_symbols.simplify]() {
    const items = this.#items;

    if (!items?.size) return NOOP_CANCELLABLE;

    for (const item of items) {
      if (item[_symbols.isDefused]) {
        items.delete(item);
      }
    }

    if (items.size > 1) return this;

    const [first] = items;
    if (first) return first;

    this.#items = undefined;
    this[_symbols.isDefused] = true;

    return NOOP_CANCELLABLE;
  }

  override tryCancelSync(reason: unknown = new CancellationError()): PromiseLike<undefined> | undefined {
    if (this.#promise) return this.#promise;
    const items = this.#items;
    const error = toErrorForCancellation(reason);

    if (!items) return;

    const errors = new Set();

    const promises = new Set<PromiseLike<undefined>>();

    this.#items = undefined;

    for (const item of items) {
      try {
        const p = item.tryCancelSync(error)?.then(undefined, e => void errors.add(e));
        if (p) {
          promises.add(p);
        }
      } catch (e) {
        errors.add(e);
      }
    }

    let [promise] = promises;

    if (!promise) {
      this[_symbols.isDefused] = true;
      if (errors.size) throw combineErrors(errors);
      return;
    }

    this.#items = items;

    if (promises.size > 1) {
      promise = joinPromises(promises);
    }

    promise = promise?.then((): undefined => {
      this.#promise = this.#items = undefined;
      if (errors.size) throw combineErrors(errors);
    });

    return (this.#promise = promise);
  }

  override [Symbols.cancellableAdding](key?: CancellableParent, options?: AddCancellableOptions) {
    const items = this.#items;
    if (!items?.size) return false;

    if (key) {
      const subs = new Set<Subscription>();

      for (const item of items) {
        const sub = key.add(item, options);
        if (sub) {
          subs.add(sub);
        }
      }
      return subs.size ? Subscription.collect(subs) : false;
    }

    let subs: Set<Subscription> | undefined = new Set();

    for (const item of items) {
      const ret = item[Symbols.cancellableAdding]?.(undefined, options);

      if (ret === false) {
        subs = undefined;
        continue;
      }

      if (ret instanceof Subscription) {
        subs?.add(ret);
        continue;
      }

      return;
    }

    return subs?.size ? Subscription.collect(subs) : false;
  }
}
