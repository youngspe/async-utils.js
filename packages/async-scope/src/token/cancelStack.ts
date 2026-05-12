import { cascadeSync, type ValueOrFunction } from '@youngspe/common-async-utils';
import { type CancellableLike, type CancellableOptions, type CancellationListener } from '../cancel.ts';
import { toErrorForCancellation, unwrapCancellationError } from '../error.ts';
import { Subscription } from '../events.ts';
import * as Symbols from '../symbols.ts';
import { Token, type AddCancellableOptions, type TokenController } from './token.ts';
import { SafeCancellable } from '#pkg/safeCancellable';

/**
 * Similar to a {@link Token}, but items are only cancelled after more recently-added items have
 * been cancelled.
 */
export abstract class CancelStack {
  /**
   * @see {@linkcode Token#use()}
   * @see {@linkcode CancelStack#tryUse()}
   */
  use<X>(target: ValueOrFunction<X & CancellableLike, [token: Token], X>, options?: CancellableOptions): X {
    const { token, controller } = this._pushTokenController(options && Token.from(options), {
      transient: false,
      passive: false,
    });

    try {
      return token.use(target);
    } finally {
      controller?.softDefuse();
    }
  }
  /**
   * @see {@linkcode Token#tryUse()}
   * @see {@linkcode CancelStack#use()}
   */
  tryUse<X>(
    target: ValueOrFunction<X & CancellableLike, [token: Token], X>,
    options?: CancellableOptions,
  ): X | undefined {
    const { token, controller } = this._pushTokenController(options && Token.from(options), {
      transient: false,
      passive: false,
    });

    try {
      return token.tryUse(target);
    } finally {
      controller?.softDefuse();
    }
  }

  /**
   * Pushes a {@link Token} to the stack.
   * @returns the created token.
   */
  pushToken(options?: CancellableOptions): Token {
    const token = options && Token.from(options);
    return this._pushToken(token, { transient: false, passive: false });
  }

  /**
   * Pushes a new sub-stack to the stack.
   * @returns the created stack.
   */
  pushStack(options?: CancellableOptions): CancelStack {
    return this._pushToken(options && Token.from(options), {
      transient: true,
      passive: false,
    }).createStack();
  }

  /**
   * Pushes the given cancellable to the stack.
   * @returns a {@link Subscription} that can be used to permanently or temporarily remove the
   * cancellable from the stack.
   *
   * @see {@linkcode Token#add()}
   */
  push(
    target: CancellableLike<CancellationListener>,
    options?: AddCancellableOptions,
  ): Subscription | undefined {
    const passive = options?.passive ?? false;

    const { token, controller } = this._pushTokenController(undefined, { passive, transient: false });

    try {
      return token.add(target, options && { ...options, passive: false });
    } finally {
      controller?.softDefuse();
    }
  }

  /** Underlying implementation for {@link CancelStack#pushToken} */
  protected _pushToken(token: Token | undefined, options: { transient: boolean; passive: boolean }): Token {
    return this._pushTokenController(token, options).token;
  }

  /**
   * If the associated {@link Token} has already been cancelled, this property contains the
   * associated error.
   * Otherwise, this is `undefined`.
   */
  abstract get error(): Error | undefined;

  /**
   * Pushes a {@link TokenController} to the stack, returning it and a token cancelled by it or the
   * `token` argument.
   */
  protected abstract _pushTokenController(
    token: Token | undefined,
    options: { transient: boolean; passive: boolean },
  ): { token: Token; controller?: TokenController | undefined };
}

export class DefaultCancelStack extends CancelStack {
  #error: Error | undefined;
  #state;
  private constructor(state: WeakRef<InstanceType<typeof DefaultCancelStack.State>> | undefined) {
    super();
    this.#state = state;
  }

  override get error() {
    if (this.#error) return this.#error;
    const state = this.#state?.deref();
    const error = state?.parent?.error;
    if (error) {
      this.#error = error;
      this.#state = undefined;
    }

    return error;
  }

  override push(
    target: CancellableLike<CancellationListener>,
    options: AddCancellableOptions,
  ): Subscription | undefined {
    if (this.#error) return undefined;

    const state = this.#state?.deref();
    if (!state) return Subscription.noop;

    const passive = options?.passive ?? false;
    const token = state.addToken(passive, true);

    return token.add(target, options && { ...options, passive: false });
  }

  override _pushTokenController(
    bound: Token | undefined,
    { transient }: { transient: boolean },
  ): { token: Token; controller?: TokenController | undefined } {
    if (this.#error) return { token: Token.cancelled(this.#error) };

    const state = this.#state?.deref();

    return state?.addTokenController(false, transient, bound) ?? { token: bound ?? Token.static };
  }

  static create(this: void, parent: Token): DefaultCancelStack {
    return new DefaultCancelStack.State(parent).stack;
  }

  static State = class extends SafeCancellable {
    layers: Map<object, TokenController> | undefined = new Map();
    parent: Token | undefined;
    parentSub: Subscription | undefined;
    activeCount = 0;
    stack: DefaultCancelStack;

    constructor(parent: Token) {
      super();
      this.parent = parent;
      this.parentSub = parent.add(this, { paused: true });
      this.stack = new DefaultCancelStack(new WeakRef(this));
    }

    defuse() {
      const layers = this.layers;
      if (!layers) return;
      this.layers = undefined;
      this[SafeCancellable.symbols.isDefused] = true;
      this.parentSub?.dispose();
      this.parent = this.parentSub = undefined;
      this.stack.#state = undefined;

      const errors = new Set<unknown>();

      const controllers = Array.from(layers.values()).reverse();
      layers.clear();

      for (const ctrl of controllers) {
        ctrl.defuse();
      }

      controllers.length = 0;

      if (errors.size > 1) throw toErrorForCancellation(errors);
    }

    override tryCancelSync(error: Error) {
      const layers = this.layers;
      if (!layers) return;
      this.layers = this.parent = this.parentSub = undefined;
      this[SafeCancellable.symbols.isDefused] = true;
      this.stack.#state = undefined;

      const errors = new Set<unknown>();

      const entries = Array.from(layers).reverse();
      layers.clear();

      return cascadeSync(
        undefined,
        entries.map(([, value]) => () => {
          try {
            return value.tryCancelSync(error)?.then(undefined, (e): undefined => {
              if (!unwrapCancellationError(e)) {
                errors.add(e);
              }
            });
          } catch (e) {
            if (!unwrapCancellationError(e)) {
              errors.add(e);
            }
          }
        }),
      );
    }

    override [Symbols.cancellableRemoved](): void {
      this.defuse();
    }

    addTokenController(
      passive: boolean,
      transient: boolean,
      token?: Token,
    ): { token: Token; controller?: TokenController | undefined } {
      if (this.stack.#error) return { token: Token.cancelled(this.stack.#error) };

      {
        const error = this.parent?.error;
        if (error) {
          this.stack.#error = error;
          this.stack.#state = undefined;
          this.parent = this.parentSub = this.layers = undefined;
          return { token: Token.cancelled(error) };
        }
      }

      if (token?.isCancelled) return { token };

      const layers = this.layers;
      const parent = this.parent;
      const parentSub = this.parentSub;
      if (!layers || !parent || !parentSub) return { token: token ?? Token.static };

      const key = {};

      const ctrl = Token.createController({
        pollError: () => parent.error,
        sealed: true,
        transient,
        onAfterCancel: () => {
          layers.delete(key);
        },
        onDefuse: () => {
          layers.delete(key);
        },
        init:
          passive ? undefined : (
            () => ({
              resume: () => {
                if (this.activeCount++ === 0) {
                  parentSub.resume();
                }
                return {
                  pause: () => {
                    if (--this.activeCount === 0) {
                      parentSub.pause();
                    }
                  },
                };
              },
            })
          ),
      });

      layers.set(key, ctrl);

      return { token: token ? Token.from([ctrl.token, token]) : ctrl.token, controller: ctrl };
    }

    addToken(passive: boolean, transient: boolean, token?: Token): Token {
      return this.addTokenController(passive, transient, token).token;
    }
  };
}

export class CancelledCancelStack extends CancelStack {
  override readonly error;
  constructor(error: Error) {
    super();
    this.error = error;
  }

  override pushToken(): Token {
    return Token.cancelled(this.error);
  }
  override _pushToken(): Token {
    return Token.cancelled(this.error);
  }
  override _pushTokenController() {
    return { token: Token.cancelled(this.error) };
  }
  override push(): undefined {
    return undefined;
  }
  override use(): never {
    throw this.error;
  }
  override tryUse(): undefined {
    return undefined;
  }
}

export class DefusedCancelStack extends CancelStack {
  readonly error = undefined;
  override pushToken(options?: CancellableOptions) {
    return Token.from(options);
  }
  override _pushTokenController(token?: Token) {
    return { token: token ?? Token.static };
  }
  override push() {
    return Subscription.noop;
  }
}

export function createTokenStack(options: CancellableOptions): CancelStack {
  const token = Token.from(options);
  const { error } = token;

  if (error) return new CancelledCancelStack(error);
  if (token.isDefused) return new DefusedCancelStack();
  return DefaultCancelStack.create(token);
}
