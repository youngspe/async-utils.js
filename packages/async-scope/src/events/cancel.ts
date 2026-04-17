import { joinPromises } from '@youngspe/common-async-utils';

import { cancelObject, type CancellableOrDisposable, type CancellableParent } from '../cancel.ts';
import { toErrorForCancellation } from '../error.ts';
import * as Symbols from '../symbols.ts';
import { Token, type TokenController } from '../token.ts';
import type { Awaitable, Falsy } from '../types.ts';
import { GenericEventEmitter, type GenericEventController } from './generic.ts';
import { type Subscription } from './sub.ts';
import type { AddCancellableOptions } from '../token/base.ts';

export class CancelEvent extends Token {
  #inner;
  #key: { error: Error | undefined } = { error: undefined };
  #pollError;
  #defused = false;

  constructor(
    inner: GenericEventEmitter<Error, Awaitable<void>>,
    pollError?: (this: void) => Error | 'defused' | undefined,
  ) {
    super();
    this.#inner = inner;
    this.#pollError = pollError;
  }

  override get error(): Error | undefined {
    if (this.#key.error) return this.#key.error;

    if (this.#pollError) {
      const error = this.#pollError();

      if (!error) return undefined;

      this.#pollError = undefined;

      if (error === 'defused') {
        this.#defused = true;
        return undefined;
      }

      return (this.#key.error = error);
    }

    return undefined;
  }

  override get isDefused() {
    if (this.#defused) return true;

    if (this.#pollError) {
      const error = this.#pollError();
      if (!error) return false;
      this.#pollError = undefined;

      if (error === 'defused') return (this.#defused = true);

      this.#key.error ??= error;
    }

    return false;
  }

  protected override addOne(
    listener: CancellableOrDisposable,
    { paused, passive }: AddCancellableOptions = {},
  ): Subscription | undefined {
    if (this.#key.error) return undefined;

    const sub = this.#inner.add(e => cancelObject(listener, e), {
      once: true,
      onRemove:
        listener[Symbols.cancellableRemoved]
        && (() => void listener[Symbols.cancellableRemoved]?.(this.#key)),
      paused,
      passive,
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
    #filter;
    #sealed;

    constructor(
      inner: GenericEventController<Error, Awaitable<void>>,
      callbacks: Token.Callbacks,
      sealed: boolean,
      filter: ((error: Error) => true | Error | Falsy | 'defuse') | undefined,
      pollError: ((this: void) => Error | 'defused' | undefined) | undefined,
    ) {
      this.#inner = inner;
      this.#callbacks = callbacks;
      this.token = new CancelEvent(inner.emitter, pollError);
      this.#sealed = sealed;
      this.#filter = filter;
    }

    readonly token: CancelEvent;

    readonly cancel = (reason?: unknown) => {
      let error = toErrorForCancellation(reason);
      const filter = this.#filter;

      if (filter) {
        const result = filter(error);
        if (!result) return Promise.resolve();

        this.#filter = undefined;

        if (result === 'defuse') {
          this.defuse();
          return Promise.resolve();
        } else if (result instanceof Error) {
          error = result;
        }
      }

      return (this.#promise ??= (async () => {
        this.token.#key.error = error;
        this.token.#pollError = undefined;
        const callbacks = this.#callbacks;

        const { onBeforeCancel, onAfterCancel } = callbacks;
        callbacks.onBeforeCancel = callbacks.onAfterCancel = callbacks.onDefuse = undefined;

        const errors = new Set<unknown>();

        try {
          await onBeforeCancel?.(error);
        } catch (e) {
          errors.add(e);
        }

        await joinPromises(
          this.#inner.getListeners().listeners(),
          l => l(error),
          undefined,
          e => void errors.add(e),
        );

        try {
          await onAfterCancel?.(error);
        } catch (e) {
          errors.add(e);
        }

        this.#inner.dispose();
        if (errors.size) throw toErrorForCancellation(errors);
      })());
    };
    readonly defuse = () => {
      if (this.token.#defused) return;

      if (!this.token.#key.error) {
        this.token.#defused = true;
      }
      this.#filter = this.token.#pollError = undefined;
      this.#promise ??= Promise.resolve();
      this.#inner.dispose();
    };

    [Symbols.cancellableAdded] = (key: CancellableParent, sub: Subscription) => {
      if (this.token.isDefused || this.token.isCancelled || this.#parentSubs.has(key)) return false;
      this.#parentSubs.set(key, sub);
      return true;
    };
    [Symbols.cancellableRemoved] = (key: CancellableParent) => {
      const removed = this.#parentSubs.delete(key);
      if (!removed) return;

      let shouldDefuse = this.#sealed && this.#parentSubs.size === 0;

      if (key.error) {
        // If there was an error but all listeners are currently paused, defuse because we won't
        if (!this.token.#key.error && !this.#inner.isActive()) {
          shouldDefuse = true;
        }

        this.token.#key.error = key.error;
        this.token.#pollError = this.#filter = undefined;
      }

      if (shouldDefuse) {
        this.defuse();
      }
    };
    readonly [Symbol.asyncDispose] = this.cancel;

    static createInner({
      onAfterCancel,
      onBeforeCancel,
      onDefuse,
      init,
      dispose,
      sealed = false,
      filter,
      pollError,
    }: Token.CreateParams): GenericEventController<Error, Awaitable<void>, false, Controller> {
      const callbacks = { onBeforeCancel, onAfterCancel, onDefuse };

      return GenericEventEmitter.createController({
        context: ctrl => new CancelEvent.#Controller(ctrl, callbacks, sealed, filter, pollError),
        init: ({ context }) => {
          context.token.#pollError = undefined;
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
