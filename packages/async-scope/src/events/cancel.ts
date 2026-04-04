import { cancelObject, type CancellableOrDisposable, type CancellableParent } from '../cancel.ts';
import { combineErrors, toError } from '../error.ts';
import * as Symbols from '../symbols.ts';
import { joinPromises } from '../join.ts';
import { Token, type TokenController } from '../token.ts';
import type { Awaitable } from '../types.ts';
import { GenericEventEmitter, type GenericEventController } from './generic.ts';
import { type Subscription } from './sub.ts';

export class CancelEvent extends Token {
  #inner;
  #error: Error | undefined;
  #key: object = {};

  constructor(inner: GenericEventEmitter<Error, Awaitable<void>>) {
    super();
    this.#inner = inner;
  }

  override get error(): Error | undefined {
    return this.#error;
  }

  protected override addOne(listener: CancellableOrDisposable): Subscription | undefined {
    if (this.#error) return undefined;

    const sub = this.#inner.add(e => cancelObject(listener, e), {
      once: true,
      onRemove:
        listener[Symbols.cancellableRemoved]
        && (() => void listener[Symbols.cancellableRemoved]?.(this.#key)),
    });

    if (sub.isActive) {
      listener[Symbols.cancellableAdded]?.(this.#key, sub);
    }

    return sub;
  }

  static #Controller = class Controller implements TokenController {
    #inner;
    #parentSubs = new Map<CancellableParent, Subscription>();
    #promise: Promise<void> | undefined;
    #callbacks;

    constructor(inner: GenericEventController<Error, Awaitable<void>>, callbacks: Token.Callbacks) {
      this.#inner = inner;
      this.#callbacks = callbacks;
      this.token = new CancelEvent(inner.emitter);
    }

    readonly token: CancelEvent;

    readonly cancel = (reason?: unknown) =>
      (this.#promise ??= (async error => {
        this.token.#error = error;
        const callbacks = this.#callbacks;

        const { onBeforeCancel, onAfterCancel } = callbacks;
        callbacks.onBeforeCancel = callbacks.onAfterCancel = callbacks.onDefuse = undefined;

        const errors = new Set();

        try {
          await onBeforeCancel?.(error);
        } catch (e) {
          errors.add(e);
        }

        await joinPromises(
          this.#inner.getListeners().listeners(),
          l => l(error),
          undefined,
          e => errors.add(e),
        );

        try {
          await onAfterCancel?.(error);
        } catch (e) {
          errors.add(e);
        }

        if (errors.size) throw combineErrors(errors);
      })(toError(reason)));
    readonly defuse = () => this.#inner.dispose();

    [Symbols.cancellableAdded] = (key: CancellableParent, sub: Subscription) => {
      if (this.token.isDefused || this.token.isCancelled || this.#parentSubs.has(key)) return false;
      this.#parentSubs.set(key, sub);
      return true;
    };
    [Symbols.cancellableRemoved] = (key: CancellableParent) => {
      this.#parentSubs.delete(key);
    };
    readonly [Symbol.asyncDispose] = this.cancel;

    static createInner({
      onAfterCancel,
      onBeforeCancel,
      onDefuse,
      init,
      dispose,
    }: Token.CreateParams): GenericEventController<Error, Awaitable<void>, false, Controller> {
      const callbacks = { onBeforeCancel, onAfterCancel, onDefuse };

      return GenericEventEmitter.createController({
        context: ctrl => new CancelEvent.#Controller(ctrl, callbacks),
        init: ({ context }) => {
          const parents = context.#parentSubs;
          const _init = init?.(context);
          return {
            resume: ({ context }) => {
              const parents = context.#parentSubs;

              for (const sub of parents.values()) {
                sub.resume();
              }

              const _resume = _init?.resume?.(context);
              return {
                pause: () => {
                  try {
                    _resume?.pause?.();
                  } finally {
                    parents.forEach(sub => sub.pause());
                  }
                },
              };
            },
            close: () => {
              parents.forEach(sub => sub.dispose());
              parents.clear();
              try {
                _init?.close?.();
              } finally {
                const { onDefuse } = callbacks;
                callbacks.onBeforeCancel = callbacks.onAfterCancel = callbacks.onDefuse = undefined;
                onDefuse?.();
              }
            },
          };
        },
        dispose,
      });
    }
  };

  static override createController(this: void, params: Token.CreateParams = {}): TokenController {
    return CancelEvent.#Controller.createInner(params).context;
  }
}
