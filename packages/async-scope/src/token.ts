import { CancellationRegistry, type CancellationController } from './token/registry.ts';
import { CancellationError, toError } from './error.ts';
import type {
  CancellableOrDisposable,
  CancellableLike,
  CancellationListener,
  Cancellable,
} from './cancel.ts';
import Symbols from './symbols.ts';
import type { Awaitable, Falsy } from './types.ts';
import { isArray } from './utils.ts';

export abstract class Token {
  /**
   * The reason for the cancellation if this token has already been cancelled, otherwise `undefined`.
   *
   * @see {@link Token#isCancelled}
   */
  abstract get error(): Error | undefined;

  /** If `true`, this token has been _defused_, meaning it is guaranteed never to be cancelled. */
  get isDefused() {
    return false;
  }

  /**
   * If `true`, this token has been _cancelled_, and trigger any additional listeners.
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
   * - `true` or `undefined` if either the listener was safely added or the token is defused.
   * - `false` if the listener could not be safely added. This is typically due to the token being
   *   cancelled and indicates any future attempts will also fail.
   */
  protected abstract addOne(key: object, listener: CancellableOrDisposable): boolean | void;

  /**
   * Removes a single listener from this token.
   *
   * If a listener is still attached that was previous registered with {@link addOne} using `key`, it should
   * be removed.
   *
   * If this method is called after the token has been cancelled or defused, or if there is no listener
   * attached that was registered using `key` it should do nothing.
   *
   * @param key - an arbitrary object used as an identifier for some listener.
   */
  protected abstract removeOne(key: object): void;

  /**
   * Adds listeners
   *
   * @param listeners - listeners that should be added to this token.
   * Each parameter may be:
   * - A {@link CancellableLike}:
   *   - A {@link Cancellable}
   *   - A {@link Disposable}
   *   - An {@link AsyncDisposable}
   *   - A falsy value, which will be ignored
   *   - A (possibly nested) array of any of the above.
   * - A function that receives an {@link Error} and optionally returns a promise.
   *
   * @returns
   * - `true` if either the listeners were safely added or the token is defused.
   * - `false` if no listener could be safely added. This is typically due to the token being cancelled
   *   and indicates any future attempts will also fail.
   */
  add(...listeners: (CancellableLike | CancellationListener)[]): boolean {
    if (this.isCancelled) return false;
    if (this.isDefused) return true;

    let out = true;

    for (let listener of listeners) {
      if (!listener) continue;

      if (isArray(listener)) {
        this.add(...listener);
        continue;
      }

      const key: object = listener;

      if (typeof listener === 'function') {
        listener = { cancel: listener };
      }

      if (this.addOne(key, listener) === false) {
        out = false;
      }
    }

    return out;
  }

  /**
   * Removes the given listeners from the token.
   *
   * This should be used when a resource no longer needs to be cleaned up.
   *
   * @param listeners - listeners previous added with {@link add} or {@link use} that should be removed if
   * still present.
   *
   * @example
   *
   * function delay(ms: number, token: Token) {
   *   return new Promise<void>((resolve, reject) => {
   *     const listener = token.use(() => {
   *
   *     }));
   *
   *     const handle = setTimeout(() => {
   *       // Remove the listener now that the timer is complete and can't be cancelled.
   *       token.remove(reject);
   *       resolve();
   *     }, ms);
   *   });
   * }
   */
  remove(...listeners: (CancellableLike | CancellationListener)[]) {
    if (this.isCancelled || this.isDefused) return;

    for (const key of listeners) {
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

    this.addOne(listener, listener);

    return (this.#signal = ac.signal);
  }

  throwIfCancelled(): void {
    const { error } = this;
    if (error) throw error;
  }

  static withController(
    this: void,
    options?: Token.CreateWithControllerOptions,
  ): { token: Token; controller: CancellationController } {
    return CancellationRegistry.createPair(options);
  }

  /** A token that will never be cancelled. */
  static get static(): Token {
    return STATIC_TOKEN;
  }

  /** @returns a token that has already been cancelled. */
  static cancelled(reason: unknown = new CancellationError()): Token {
    return new CancelledToken(toError(reason));
  }

  /**
   *
   * @returns A {@link Token} that will be cancelled when any of the given tokenss are
   * cancelled.
   *
   * If present, the first token encountered that has already been called will be returned.
   */
  static combine(src: Iterable<Token | Falsy>): Token {
    let last = undefined;
    let out = undefined;
    let controller = undefined;

    for (const item of src) {
      if (!item) continue;
      if (item.isCancelled) return item;
      last = item;
      if (item.isDefused) continue;

      if (!out) {
        out = item;
        continue;
      }

      if (!controller) {
        ({ controller, token: out } = Token.withController());
      }

      item.add(controller);
    }

    return out ?? last ?? STATIC_TOKEN;
  }

  /** @returns a {@link Token} that is cancelled when `signal` is aborted. */
  static fromAbortSignal(signal: AbortSignal, options?: Token.FromAbortSignalOptions): Token {
    if (signal.aborted) return new CancelledToken(toError(signal.reason));

    const { token, controller } = CancellationRegistry.createPair({
      onDefuse() {
        signal.addEventListener('abort', listener, { once: true });
      },
    });

    const listener = () =>
      void controller.cancel(signal.reason).catch(e => {
        if (options?.onError) return options.onError(toError(e));

        throw e;
      });

    return token;
  }
}

export namespace Token {
  export interface CreateWithControllerOptions {
    /**
     * Called when the token is defused either explicitly or due to the controller getting garbage
     * collected.
     */
    onDefuse?: (() => void) | undefined;
    /**
     * Called on {@link CancellationController.cancel}. If a promise-like is returned, no listeners will be
     * notified of the cancellation until after the promise-like resolves.
     *
     * If this callback throws or rejects, the {@link CancellationController.cancel} promise will also
     * reject after all cancellation listeners and the {@link onBeforeCancel} promise is settled
     * if present.
     */
    onBeforeCancel?: ((error: Error) => Awaitable<void>) | undefined;

    /**
     * Called after all promises returned by cancellation listeners have either resolved or rejected.
     *
     * If this callback exists and returns a promise-like, the {@link CancellationController.cancel} promise
     * will not resolve until after this promise-like is settled.
     *
     * If this callback throws or rejects, the {@link CancellationController.cancel} promise will
     * also reject.
     */
    onAfterCancel?: ((error: Error) => Awaitable<void>) | undefined;
  }

  export interface FromAbortSignalOptions extends CreateWithControllerOptions {
    /**
     * Called asynchronously after the signal is aborted if any of the cancellation listeners or callbacks
     * either throw or reject.
     *
     * If this is not provided, any errors thrown during cancellation will be unhandled rejections.
     */
    onError?: ((reason: Error) => void) | undefined;
  }
}

/** Singleton class for {@link STATIC_TOKEN}. */
class StaticSource extends Token {
  override get error() {
    return undefined;
  }

  override get isDefused() {
    return true;
  }

  protected override addOne(): boolean | void {}

  protected override removeOne(): void {}
}

/**
 * A {@link Token} that will never be cancelled.
 * @see {@link Token.static}.
 */
export const STATIC_TOKEN: Token = new StaticSource();

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
  protected override addOne(): boolean | void {
    return false;
  }
  protected override removeOne(): void {}
}
