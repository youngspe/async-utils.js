import { CancellationTokenBase } from '@youngspe/async-scope-common';
import { isIterable, type ValueOrFunction } from '@youngspe/common-async-utils';

import { CancellationError, toErrorForCancellation } from '#pkg/error';
import type { CancellableLike, CancellationListener, CancellableOptions } from '#pkg/cancel';
import * as Symbols from '#pkg/symbols';
import type { Awaitable, Falsy } from '#pkg/types';
import { Subscription, type SubscriptionLifecycle } from '#pkg/events';
import { CancelEvent, combineTokenSet, createTokenStack, expandTokenToSet } from '#pkg/token';
import type {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Scope,
  ToScope,
} from '#pkg/scope';
import { SafeCancellable } from '#pkg/safeCancellable';

export interface AddCancellableOptions {
  paused?: boolean | undefined;
  passive?: boolean | undefined;
}

export type ErrorFilter = (this: void, error: Error) => true | Error | 'defuse' | Falsy;
/**
 * A {@link Token} represents the span of an asynchronous operation and is used to signal
 * errors, cancellation, or completion of that operation. It provides a mechanism to coordinate
 * the lifecycle of multiple asynchronous tasks, allowing them to respond to shared signals about
 * the overall operation's status.
 *
 * Tokens are the primary mechanism for cancellation in the async-scope ecosystem. When a scope
 * is cancelled (via `token.cancel()`), all tokens associated with that scope and its children
 * receive the cancellation signal. This enables graceful cleanup and termination of long-running
 * operations.
 *
 * ## Cancellation Semantics
 *
 * When a token is cancelled:
 *
 * - The {@linkcode error} property is set to the cancellation reason
 * - {@linkcode isCancelled} becomes `true`
 * - All active listeners receive the cancellation error
 * - The associated {@link signal|AbortSignal} is aborted
 *
 * Cancellation handlers registered via {@linkcode add()}, {@linkcode use()}, or {@linkcode tryUse()} are called in the order
 * they were registered. Handlers may return a promise, in which case they are awaited
 * concurrently before cancellation completes.
 *
 * Tokens support composition via {@linkcode Token.combine()} and {@linkcode Token.from()}, enabling complex
 * cancellation scenarios where multiple sources can trigger cancellation.
 *
 * @example
 * <caption>Using a `TokenController`</caption>
 *
 * import { Token, Scope } from '@youngspe/async-scope';
 *
 * function timeoutToken(ms: number): Token {
 *   const { cancel, token } = Token.createController();
 *   setTimeout(cancel, ms);
 *   return token
 * }
 *
 * @see {@link Scope}
 * @see {@link Token.create}
 * @see {@link Token.createController}
 * @see {@link Token.from}
 */
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
   * {@link Disposable}, or {@link AsyncDisposable}.
   * @returns
   * - A {@link Subscription} if either the listener was safely added or the token is defused.
   * - `undefined` if the listener could not be safely added. This is typically due to the token being
   *   cancelled and indicates any future attempts will also fail.
   */
  protected abstract _add(
    listener: SafeCancellable,
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

    const listeners = SafeCancellable.arrayFrom(listener);

    const subs: Subscription[] = [];

    for (const item of listeners) {
      const sub = this._add(item, options);
      if (!sub) {
        subs.forEach(s => s.dispose());
        return undefined;
      }
      subs.push(sub);
    }

    return Subscription.collect(subs);
  }

  use<X>(target: ValueOrFunction<X & CancellableLike, [token: Token], X>, options?: CancellableOptions): X {
    const token = options ? Token.from([this, options]) : this;

    if (typeof target === 'function') {
      const { error } = token;
      if (error) throw error;

      const value = target(token);
      if ((value !== null && typeof value === 'object') || typeof value === 'function') {
        token.add(value as CancellableLike);
      }
      return value;
    }

    const sub = token.add(target);
    if (!sub) {
      const { error } = token;
      if (error) throw error;
    }

    return target;
  }

  /**
   * Attempts to add a listener to this token.
   * Returns the target if successfully added, or `undefined` if not added.
   */
  tryUse<X>(
    target: ValueOrFunction<X & CancellableLike, [token: Token], X>,
    options?: CancellableOptions,
  ): X | undefined {
    const token = options ? Token.from([this, options]) : this;

    if (typeof target === 'function') {
      if (token.isCancelled) return undefined;

      const value = target(token);
      if ((value !== null && typeof value === 'object') || typeof value === 'function') {
        token.add(value as CancellableLike);
      }
      return value;
    }

    return token.add(target) ? target : undefined;
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

    this._add(
      SafeCancellable.from({
        cancel: ac.abort.bind(ac),
        [Symbols.cancellableRemoved]: () => {
          // Discard the AbortSignal on defuse so we don't keep the event listeners.
          this.#signal = undefined;
        },
      }),
    );

    return (this.#signal = ac.signal);
  }

  /** @throws if this token is already cancelled */
  throwIfCancelled(): void {
    const { error } = this;
    if (error) throw error;
  }

  /**
   * Creates a token that, when this token is cancelled, is either cancelled or defused depending
   * on the output of the given function.
   */
  filter(filter: ErrorFilter): Token {
    const ctrl = Token.createController({ filter, sealed: true });
    this.add(ctrl, { passive: true });
    return ctrl.token;
  }

  createStack(options?: CancellableOptions) {
    return createTokenStack({ token: [this, options] });
  }

  /**
   * If possible, returns a more optimized version of this token.
   * Otherwise, returns `this`.
   */
  protected _simplify(): Token {
    if (this.isDefused) return Token.static;
    return this;
  }

  /**
   * Creates a {@link TokenController}, which contains a {@link Token} and methods for managing the
   * token lifecycle.
   *
   * Accepts all options accepted by {@linkcode create()}.
   *
   * @see {@linkcode create()}
   */
  static createController(this: void, options?: Token.CreateParams): TokenController {
    return CancelEvent.createController(options);
  }

  /**
   * Creates a {@link Token} based on the given options and lifecycle callbacks.
   *
   * ## Lifecycle Callbacks
   *
   * - `init`: Called at most once when the first cancellable is added.
   *   This may return `undefined` or an object with optional `resume` and `close` callbacks:
   *   - `resume`: Called when a cancellable is added when there previously were none.
   *     This may return `undefined` or an object with an optional `pause` callback:
   *     - `pause`: Called when all cancellables have been removed.
   *       If a cancellable is added afterward, `resume` will be called again.
   *   - `stop`: Called when the token is either defused or cancelled, but only if `init` has
   *     previously been called.
   * - `dispose`: Called when the token is either defused or cancelled, even if no cancellables were
   *   ever added to the token.
   * - `onDefuse`: Called when the token is defused
   * - `onBeforeCancel`: Called on cancellation and awaited before any cancellables are notified.
   * - `onAfterCancel`: Called after all cancellables are notified.
   *
   *
   *
   * @example
   *
   * import { Token } from '@youngspe/async-scope';
   *
   * // This token is cancelled when ctrl-c is pressed.
   * const sigintToken = Token.create({
   *   init: () => ({
   *     resume: ({ cancel }) => {
   *       const handler = () => cancel();
   *       // When the first cancellable is added, add the event listener:
   *       process.once('SIGINT', handler);
   *
   *       return {
   *         pause: () => {
   *           // When the last cancellable is removed, remove the event listener:
   *           process.off('SIGINT', handler);
   *         },
   *       };
   *     },
   *   }),
   * });
   */
  static create(this: void, options: Token.CreateParams): Token {
    return Token.createController(options).token;
  }

  /**
   * A token that is already defused, meaning it will never be cancelled.
   */
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
    let loneToken: Token | undefined = STATIC_TOKEN;

    const tokens = new Set<Token>();

    for (const item of src) {
      if (!item) continue;
      const beforeSize = tokens.size;

      const out = expandTokenToSet(item, tokens);
      if (out) return out;

      if (beforeSize === 0) {
        loneToken &&= item;
      } else if (tokens.size > beforeSize) {
        loneToken = undefined;
      }

      tokens.add(item);
    }

    if (tokens.size > 1) return loneToken ?? combineTokenSet(tokens) ?? STATIC_TOKEN;

    const [token] = tokens;
    return token ?? STATIC_TOKEN;
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

  /**
   * Creates a token from a {@link Scope}-like value.
   *
   * This may be:
   * - A {@link Token}
   * - A {@link Scope}
   * - An AbortSignal
   * - An object with a `token`, `scope`, or `signal` property, such as
   *   {@link CancellableOptions}, {@link TokenController}, or `AbortController`
   * - A falsy value (e.g. `false` or `undefined`)
   *   - This results in {@linkcode Token.static}
   * - A (possibly nested) array or set of any of the above
   *   - The resulting token is cancelled when at least one of the items in the collection
   *     is cancelled.
   *
   * @see {@linkcode Scope.from()}
   */
  static from(this: void, src: ToScope): Token {
    if (!src) return STATIC_TOKEN;
    if (src instanceof Token) return src._simplify();
    let loneToken: Token | undefined = STATIC_TOKEN;
    const tokens = new Set<Token>();
    const signals = new Set<AbortSignal>();
    const visited = new Set<object>();

    /**
     * Recursively visits all nested tokens and signals in `src` and puts them in sets.
     *
     * Returning a Token rather than `undefined` indicates that a token has been encountered that
     * is already cancelled, and we should just return that rather than keep collecting tokens.
     */
    const flatten = (src: ToScope): Token | undefined => {
      if (!src) return undefined;

      if (src instanceof AbortSignal) {
        loneToken = undefined;
        // If the signal is already aborted, just return a cancelled token
        if (src.aborted) return Token.cancelled(src.reason);
        signals.add(src);
        return undefined;
      }

      if (src instanceof Token) {
        const beforeSize = tokens.size;

        const out = expandTokenToSet(src, tokens);
        if (out) return out;

        if (beforeSize === 0) {
          loneToken &&= src;
        } else if (tokens.size > beforeSize) {
          loneToken = undefined;
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

    const cancelledToken = flatten(src);
    if (cancelledToken) return cancelledToken;
    if (loneToken) return loneToken;

    // Combine all signals into a single signal:
    let [signal] = signals;

    if (signals.size > 1) {
      signal = AbortSignal.any(Array.from(signals));
    }

    if (signal) {
      tokens.add(Token.fromAbortSignal(signal));
    }

    return combineTokenSet(tokens) ?? STATIC_TOKEN;
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
     * reject after all cancellation listeners and the {@link onAfterCancel} promise is settled
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
     * If `true`, then when all listeners are removed, the token will be defused.
     *
     * @default false
     */
    transient?: boolean | undefined;
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

  protected override _add() {
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
  protected override _add(): undefined {}
}

export interface TokenController extends SafeCancellable {
  readonly token: Token;
  readonly cancel: (this: void, reason?: unknown) => Promise<undefined>;
  readonly tryCancelSync: (this: void, reason?: unknown) => undefined | Promise<undefined>;
  readonly defuse: (this: void) => undefined;

  /**
   * If the token has no non-passive listeners, defuses.
   * Otherwise, makes the token _transient_ so it defuses when all non-passive listeners
   * are removed.
   *
   * @returns `true` if the token has been defused, otherwise `false`.
   *
   * @see {@linkcode TokenController#defuse()}
   * @see {@linkcode Token.CreateParams#transient}
   */
  readonly softDefuse: (this: void) => boolean;
}
