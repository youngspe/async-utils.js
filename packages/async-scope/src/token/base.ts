import { CancellationTokenBase } from '@youngspe/async-scope-common';

import { CancellationError, toErrorForCancellation } from '../error.ts';
import type {
  CancellableOrDisposable,
  CancellableLike,
  CancellationListener,
  Cancellable,
} from '../cancel.ts';
import * as Symbols from '../symbols.ts';
import type { Awaitable, Falsy } from '../types.ts';
import { Subscription, type SubscriptionLifecycle } from '../events/sub.js';
import { CancelEvent } from '../token.ts';
import type { ToScope } from '../scope.ts';
import { isArray, isIterable } from '@youngspe/common-async-utils';

export interface AddCancellableOptions {
  paused?: boolean | undefined;
  passive?: boolean | undefined;
}

export type ErrorFilter = (this: void, error: Error) => true | Error | 'defuse' | Falsy;

export abstract class Token extends CancellationTokenBase {
  /**
   * The reason for the cancellation if this token has already been cancelled, otherwise `undefined`.
   *
   * @see {@link Token#isCancelled}
   */
  abstract override get error(): Error | undefined;

  /** If `true`, this token has been _defused_, meaning it is guaranteed never to be cancelled. */
  get isDefused() {
    return false;
  }

  /**
   * If `true`, this token has been _cancelled_, and will not trigger any additional listeners.
   *
   * This is equivalent to `token.error !== undefined`
   *
   * @see {@link Token#error}
   */
  get isCancelled() {
    return this.error !== undefined;
  }

  /**
   * Attempts to add a single listener to this token.
   * This is called by provided methods like {@link add} and {@link use}.
   *
   * @param key - an arbitrary object used as an identifier for the listener.
   * @param listener - An object that may include any of the methods of a {@link Cancellable},
   * {@link disposable}, or {@link AsyncDisposable}.
   * @returns
   * - A {@link Subscription} if either the listener was safely added or the token is defused.
   * - `undefined` if the listener could not be safely added. This is typically due to the token being
   *   cancelled and indicates any future attempts will also fail.
   */
  protected abstract addOne(
    listener: CancellableOrDisposable,
    options?: AddCancellableOptions,
  ): Subscription | undefined;

  /**
   * Adds listeners
   *
   * @param listener - a listener that should be added to this token.
   * This may be:
   * - A {@link Cancellable}
   * - A {@link Disposable}
   * - An {@link AsyncDisposable}
   * - A falsy value, which will be ignored
   * - A function that receives an {@link Error} and optionally returns a promise.
   * - A (possibly nested) array of any of the above.
   *
   * @returns
   * - A {@link Subscription} that may be used to pause, resume, or remove the provide listeners if either the listeners were safely added or the token is defused.
   * - `undefined` if no listener could be safely added. This is typically due to the token being cancelled
   *   and indicates any future attempts will also fail.
   */
  override add(
    listener: CancellableLike<CancellationListener>,
    options?: AddCancellableOptions,
  ): Subscription | undefined {
    if (this.isCancelled) return undefined;
    if (this.isDefused) return Subscription.noop;

    const subs: Subscription[] = [];

    const inner = (listener: CancellableLike<CancellationListener>): boolean => {
      if (!listener) return true;

      if (isArray(listener)) {
        for (const child of listener) {
          if (!inner(child)) return false;
        }

        return true;
      }

      if (typeof listener === 'function') {
        listener = { cancel: listener };
      }

      const sub = this.addOne(listener, options);

      if (!sub) return false;
      subs.push(sub);
      return true;
    };

    if (!inner(listener)) return undefined;
    return Subscription.collect(subs);
  }

  use<X extends CancellableLike>(target: X): X {
    const { error } = this;
    if (error) throw error;
    this.add(target);
    return target;
  }

  /**
   * Attempts to add a listener to this token.
   * Returns the target if successfully added, or `undefined` if not added.
   */
  tryUse<X extends CancellableLike>(listener: X): X | undefined {
    return this.add(listener) ? listener : undefined;
  }

  #signal: AbortSignal | undefined;

  /**
   * An {@link AbortSignal} representing this token.
   * When this token is cancelled, the returned signal will be aborted.
   * When this token is defused, a new signal is generated on each access.
   */
  get signal(): AbortSignal {
    if (this.#signal) return this.#signal;

    if (this.isDefused) {
      // When this is defused, generate a new AbortSignal every time so listeners that get added don't
      // stick around.
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

    this.addOne(listener);

    return (this.#signal = ac.signal);
  }

  throwIfCancelled(): void {
    const { error } = this;
    if (error) throw error;
  }

  filter(filter: ErrorFilter): Token {
    const ctrl = Token.createController({ filter, sealed: true });
    this.add(ctrl, { passive: true });
    return ctrl.token;
  }

  static createController(this: void, options?: Token.CreateParams): TokenController {
    return CancelEvent.createController(options);
  }

  static create(this: void, options: Token.CreateParams): Token {
    return Token.createController(options).token;
  }

  /** A token that will never be cancelled. */
  static get static(): Token {
    return STATIC_TOKEN;
  }

  /** @returns a token that has already been cancelled. */
  static cancelled(reason: unknown = new CancellationError()): Token {
    return new CancelledToken(toErrorForCancellation(reason));
  }

  /**
   *
   * @returns A {@link Token} that will be cancelled when any of the given tokens are
   * cancelled.
   *
   * If present, the first token encountered that has already been called will be returned.
   */
  static combine(src: Iterable<Token | Falsy>): Token {
    let last = undefined;

    const tokens = new Set<Token>();

    for (const item of src) {
      if (!item) continue;
      if (item.isCancelled) return item;
      last = item;
      if (item.isDefused) continue;

      tokens.add(item);
    }

    const pollError = () => {
      for (const token of tokens) {
        const { error } = token;
        if (error) return error;
        if (token.isDefused) {
          tokens.delete(token);
        }
      }

      return tokens.size ? undefined : 'defused';
    };

    if (tokens.size > 1) {
      return Token.create({
        sealed: true,
        init: ctrl => {
          const sub = Subscription.collect(Array.from(tokens, t => t.add(ctrl)));
          return {
            resume: () => {
              sub.resume();
              return { pause: () => sub.pause() };
            },
            close: () => {
              sub.dispose();
            },
          };
        },
        pollError,
      });
    }

    const [token] = tokens;

    return token ?? last ?? STATIC_TOKEN;
  }

  /** @returns a {@link Token} that is cancelled when `signal` is aborted. */
  static fromAbortSignal(this: void, signal: AbortSignal, options?: Token.FromAbortSignalParams): Token {
    if (signal.aborted) return new CancelledToken(toErrorForCancellation(signal.reason));
    const { onError, ...callbacks } = options ?? {};

    return Token.create({
      ...callbacks,
      init: ({ cancel }) => {
        if (signal.aborted) return;

        return {
          resume: () => {
            if (signal.aborted) return;
            const onAbort = () => void cancel(signal.reason).catch(onError);
            signal.addEventListener('abort', onAbort, { once: true });

            return {
              pause: () => {
                signal.removeEventListener('abort', onAbort);
              },
            };
          },
        };
      },
      pollError: () => (signal.aborted ? toErrorForCancellation(signal.reason) : undefined),
    });
  }

  static from(this: void, src: ToScope): Token {
    const tokens = new Set<Token>();
    const signals = new Set<AbortSignal>();
    const visited = new Set<object>();

    const flatten = (src: ToScope): Token | undefined => {
      if (!src) return undefined;

      if (src instanceof AbortSignal) {
        if (src.aborted) return Token.cancelled(src.reason);
        signals.add(src);
        return undefined;
      }

      if (src instanceof Token) {
        if (src.isCancelled) return src;
        if (!src.isDefused) {
          tokens.add(src);
        }
        return undefined;
      }

      if (isIterable(src)) {
        for (const item of src) {
          const out = flatten(item);
          if (out) return out;
        }

        return undefined;
      }

      if (visited.has(src)) return undefined;
      visited.add(src);

      return flatten(src.scope) || flatten(src.token) || flatten(src.signal);
    };

    const cancelled = flatten(src);
    if (cancelled) return cancelled;

    let [signal] = signals;

    if (signals.size > 1) {
      signal = AbortSignal.any(Array.from(signals));
    }

    if (signal) {
      tokens.add(Token.fromAbortSignal(signal));
    }

    return Token.combine(tokens);
  }
}

export namespace Token {
  export interface Callbacks {
    /**
     * Called when the token is defused either explicitly or due to the controller getting garbage
     * collected.
     */
    onDefuse?: ((this: void) => void) | undefined;
    /**
     * Called on {@link TokenController#cancel}. If a promise-like is returned, no listeners will be
     * notified of the cancellation until after the promise-like resolves.
     *
     * If this callback throws or rejects, the {@link TokenController#cancel} promise will also
     * reject after all cancellation listeners and the {@link onBeforeCancel} promise is settled
     * if present.
     */
    onBeforeCancel?: ((this: void, error: Error) => Awaitable<void>) | undefined;

    /**
     * Called after all promises returned by cancellation listeners have either resolved or rejected.
     *
     * If this callback exists and returns a promise-like, the {@link TokenController#cancel} promise
     * will not resolve until after this promise-like is settled.
     *
     * If this callback throws or rejects, the {@link TokenController#cancel} promise will
     * also reject.
     */
    onAfterCancel?: ((this: void, error: Error) => Awaitable<void>) | undefined;
  }

  export interface CreateParams
    extends SubscriptionLifecycle<[ctrl: TokenController], [ctrl: TokenController]>, Callbacks {
    /**
     * If provided, this function is called on an attempt to cancel the token.
     *
     * If the function returns:
     * - a falsy value, the token is unaffected.
     * - `true`, the token is cancelled normally.
     * - `'defuse'`, the token is defused instead of cancelled.
     */
    filter?: ErrorFilter;
    /**
     * If `true`, then when all parent tokens are defused or removed, the token will be defused.
     *
     * @default false
     */
    sealed?: boolean | undefined;
    /**
     * If this function is provided and returns an `Error`, indicates that the token is cancelled
     * with that error.
     *
     * If this function returns `'defused'`, indicates that the token has already been defused.
     *
     * This is only used before any listeners are added. Once the first listener is added, this
     * function is discarded.
     */
    pollError?: ((this: void) => Error | 'defused' | undefined) | undefined;
  }

  export interface FromAbortSignalParams extends Callbacks {
    /**
     * Called asynchronously after the signal is aborted if any of the cancellation listeners or callbacks
     * either throw or reject.
     *
     * If this is not provided, any errors thrown during cancellation will be unhandled rejections.
     */
    onError?: ((reason: unknown) => void) | undefined;
  }
}

/** Singleton class for {@link STATIC_TOKEN}. */
class StaticToken extends Token {
  override get error() {
    return undefined;
  }

  override get isDefused() {
    return true;
  }

  protected override addOne() {
    return Subscription.noop;
  }
}

/**
 * A {@link Token} that will never be cancelled.
 * @see {@link Token.static}.
 */
export const STATIC_TOKEN: Token = new StaticToken();

/**
 * A {@link Token} that is already cancelled.
 * @see {@link Token.cancelled}
 */
class CancelledToken extends Token {
  override readonly error: Error = new Error();
  constructor(error: Error) {
    super();
    this.error = error;
  }
  protected override addOne(): undefined {}
}

export interface TokenController extends Cancellable, AsyncDisposable {
  readonly token: Token;
  readonly cancel: (this: void, reason?: unknown) => Promise<void>;
  readonly defuse: (this: void) => void;
}
