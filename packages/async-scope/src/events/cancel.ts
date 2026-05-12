import { cascadeSync, isPromiseLike, joinPromises } from '@youngspe/common-async-utils';

import { type CancellableLike, type CancellableParent, type CancellationListener } from '../cancel.ts';
import { combineErrors, toErrorForCancellation } from '../error.ts';
import * as Symbols from '../symbols.ts';
import { Token, type TokenController } from '../token.ts';
import type { Awaitable, Falsy } from '../types.ts';
import { GenericEventEmitter, type GenericEventController } from './generic.ts';
import { Subscription } from './sub.ts';
import type { AddCancellableOptions } from '../token/token.ts';
import { SafeCancellable } from '../safeCancellable.ts';

export class CancelEvent extends Token {
  #inner;
  readonly #key: {
    error: Error | undefined;
    defused: boolean;
    add(
      listener: CancellableLike<CancellationListener>,
      options?: AddCancellableOptions,
    ): Subscription | undefined;
  } = { error: undefined, defused: false, add: this.add.bind(this) };
  #pollError;

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
        this.#key.defused = true;
        return undefined;
      }

      return (this.#key.error = error);
    }

    return undefined;
  }

  override get isDefused() {
    if (this.#key.defused) return true;

    if (this.#pollError) {
      const error = this.#pollError();
      if (!error) return false;
      this.#pollError = undefined;

      if (error === 'defused') return (this.#key.defused = true);

      this.#key.error ??= error;
    }

    return false;
  }

  protected override _add(
    listener: SafeCancellable,
    { paused, passive }: AddCancellableOptions = {},
  ): Subscription | undefined {
    const key = this.#key;
    if (key.error) return undefined;

    const addingResult = listener[Symbols.cancellableAdding]?.(key);

    if (addingResult === false) return Subscription.noop;
    if (addingResult instanceof Subscription) return addingResult;

    const sub = this.#inner.add(e => listener.tryCancelSync(e), {
      once: true,
      onRemove:
        listener[Symbols.cancellableRemoved]
        && (() => {
          // Only call cancellableRemoved if we're not in the middle of cancelling
          if (!key.error) {
            listener[Symbols.cancellableRemoved]?.(key);
          }
        }),
      paused,
      passive,
    });

    if (sub.isActive) {
      const ret = listener[Symbols.cancellableAdded]?.(key, sub);
      if (ret === false) {
        sub.dispose();
        return Subscription.noop;
      }

      if (ret instanceof Subscription) return ret;
    }

    return sub;
  }

  static #Controller = class Controller extends SafeCancellable implements TokenController {
    #inner;
    #parentSubs = new Map<CancellableParent, Subscription>();
    #promise: Promise<undefined> | undefined;
    #callbacks;
    #filter;
    #sealed;
    #tokenKey;

    constructor(
      inner: GenericEventController<Error, Awaitable<void>>,
      callbacks: Token.Callbacks,
      sealed: boolean,
      filter: ((error: Error) => true | Error | Falsy | 'defuse') | undefined,
      pollError: ((this: void) => Error | 'defused' | undefined) | undefined,
    ) {
      super();
      this.#inner = inner;
      this.#callbacks = callbacks;
      this.token = new CancelEvent(inner.emitter, pollError);
      this.#sealed = sealed;
      this.#filter = filter;
      this.#tokenKey = this.token.#key;
    }

    readonly token: CancelEvent;

    readonly tryCancelSync = (reason?: unknown): undefined | Promise<undefined> => {
      const tokenKey = this.#tokenKey;
      if (tokenKey.defused) return;

      let error = toErrorForCancellation(reason);
      const filter = this.#filter;

      if (filter) {
        const result = filter(error);
        if (!result) return;

        this.#filter = undefined;

        if (result === 'defuse') {
          this.defuse();
          return;
        } else if (result instanceof Error) {
          error = result;
        }
      }

      if (this.#promise) return this.#promise;
      if (tokenKey.error) return;

      tokenKey.error = error;
      this.token.#pollError = undefined;
      const callbacks = this.#callbacks;

      const { onBeforeCancel, onAfterCancel } = callbacks;
      callbacks.onBeforeCancel = callbacks.onAfterCancel = callbacks.onDefuse = undefined;

      const errors = new Set<unknown>();

      const runListener = (l: (error: Error) => Awaitable<void>) => {
        try {
          const p = l(error);
          if (!isPromiseLike(p)) return undefined;
          return p?.then(undefined, e => void errors.add(e));
        } catch (e) {
          errors.add(e);
        }
      };
      const before = onBeforeCancel && runListener.bind(undefined, onBeforeCancel);

      const cancelAll = () => {
        const promises: PromiseLike<void>[] = [];
        for (const l of this.#inner.getListeners().listeners()) {
          const p = runListener(l);

          if (p) {
            promises.push(p);
          }
        }

        this.#inner.dispose();

        let [out] = promises;

        if (promises.length > 1) {
          out = joinPromises(promises);
        }

        return out;
      };

      const after = onAfterCancel && runListener.bind(undefined, onAfterCancel);

      let resolve!: (value: undefined) => void;
      let reject!: (reason: unknown) => void;

      const promise = (this.#promise = new Promise<undefined>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
      }));

      const finish = (): undefined => {
        this[SafeCancellable.symbols.isDefused] = true;
        this.#promise = undefined;
        this.#parentSubs.forEach(sub => sub.dispose());

        if (errors.size) {
          reject(combineErrors(errors));
        } else {
          resolve(undefined);
        }
      };

      const isAsync = !!cascadeSync(undefined, [before, cancelAll, after, finish]);

      return isAsync ? promise : undefined;
    };

    override readonly cancel = (reason?: unknown): Promise<undefined> => {
      try {
        return Promise.resolve(this.tryCancelSync(reason));
      } catch (error) {
        return Promise.reject(error);
      }
    };

    #onDefuse() {
      this[SafeCancellable.symbols.isDefused] = true;
      this.#promise = this.#filter = this.token.#pollError = undefined;
      this.#promise = undefined;
      const key = this.#tokenKey;

      if (!key.error) {
        key.defused = true;
      }
    }

    readonly defuse = (): undefined => {
      if (this.#tokenKey.defused) return;
      this.#onDefuse();
      this.#inner.dispose();
    };

    readonly softDefuse = (): boolean => {
      const key = this.#tokenKey;
      if (key.defused) return true;
      if (key.error) return false;
      return this.#inner.softDispose();
    };

    override [Symbols.cancellableAdding] = (key?: CancellableParent) => {
      return !this.token.isDefused && !this.token.isCancelled && (!key || !this.#parentSubs.has(key));
    };

    override [Symbols.cancellableAdded] = (key: CancellableParent, sub: Subscription) => {
      if (this.token.isDefused || this.token.isCancelled || this.#parentSubs.has(key)) return false;
      this.#parentSubs.set(key, sub);
      return true;
    };
    override [Symbols.cancellableRemoved] = (key: CancellableParent) => {
      const tokenKey = this.#tokenKey;
      const removed = this.#parentSubs.delete(key);
      if (!removed || tokenKey.error) return;

      let shouldDefuse = this.#sealed && this.#parentSubs.size === 0;

      const filter = this.#filter;
      let { error } = key;
      const result = error && (filter ? filter(error) : true);

      if (!result) {
        error = undefined;
      } else if (result === 'defuse') {
        error = undefined;
        shouldDefuse = true;
      } else if (result !== true) {
        error = result;
      }

      if (error && !this.#inner.isActive()) {
        // If there was an error but all listeners are currently paused, defuse
        shouldDefuse = true;
        tokenKey.error = error;
      }

      if (shouldDefuse) {
        this.defuse();
      }
    };

    static createInner({
      onAfterCancel,
      onBeforeCancel,
      onDefuse,
      init,
      dispose,
      sealed = false,
      transient = false,
      filter,
      pollError,
    }: Token.CreateParams): GenericEventController<Error, Awaitable<void>, false, Controller> {
      const callbacks = { onBeforeCancel, onAfterCancel, onDefuse };

      return GenericEventEmitter.createController({
        context: ctrl => new CancelEvent.#Controller(ctrl, callbacks, sealed, filter, pollError),
        transient,
        init: ({ context }) => {
          const { token } = context;
          token.#pollError = undefined;
          const parents = context.#parentSubs;
          const key = context.#tokenKey;
          const _init = init?.(context);

          const _init_resume = _init?.resume;
          const _init_close = _init?.close;

          return {
            resume: ({ context }) => {
              const parents = context.#parentSubs;

              for (const sub of parents.values()) {
                sub.resume();
              }

              const _resume = _init_resume?.(context);
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
              const defusing = !key.error;

              if (defusing) {
                key.defused = true;
                key.add = () => Subscription.noop;
                parents.forEach(sub => sub.dispose());
                parents.clear();
              } else {
                key.add = () => undefined;
              }

              try {
                _init_close?.();
              } finally {
                const onDefuse = defusing ? callbacks.onDefuse : undefined;
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
