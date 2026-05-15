import {
  CancellationError,
  GenericEventEmitter,
  Scope,
  toErrorForCancellation,
  Token,
  type CancellableOptions,
  type TokenController,
} from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';
import { cascadeSync, latestUpdater } from '@youngspe/common-async-utils';

import { defineFlow, emptyFlow, failedFlow, type Flow } from '#pkg/flow';
import {
  type LifecycleTermination,
  type LifecycleEvent,
  GenericLifecycle,
  type LifecycleHandlers,
  type StandardLifecycleState,
  abortedLifecycle,
} from './lifecycle.ts';

type LifecycleControllerEvent<K extends PropertyKey, Ret> = LifecycleEvent<K> | LifecycleTermination<Ret>;

/**
 * Object that controls a {@link GenericLifecycle}.
 */
export interface LifecycleControllerLike<in K extends PropertyKey, in Ret = void>
  extends Disposable, AsyncDisposable {
  readonly setState: (this: void, state: K | undefined) => Promise<undefined>;
  readonly abort: (this: void, reason: unknown) => void;
  readonly close: (this: void, value: Ret) => void;
}

/**
 * Object that controls and contains a {@link GenericLifecycle}.
 */
export interface LifecycleController<in K extends PropertyKey, Ret = void> extends LifecycleControllerLike<
  K,
  Ret
> {
  readonly lifecycle: GenericLifecycle<K, Ret>;
}

/** Lifecycle with state managed by a {@link LifecycleController} */
class ControllableLifecycle<K extends PropertyKey, Ret> extends GenericLifecycle<K, Ret> {
  #eventEmitter;
  #current: number = -1;
  #ret: LifecycleTermination<Ret> | undefined;
  #stateIndices: Partial<Record<K, number>>;
  #scope: Scope;

  constructor(
    eventEmitter: GenericEventEmitter<LifecycleControllerEvent<K, Ret>, Awaitable<void>>,
    stateIndices: Partial<Record<K, number>>,
    scope: Scope,
  ) {
    super();
    this.#eventEmitter = eventEmitter;
    this.#stateIndices = stateIndices;
    this.#scope = scope;
  }

  #in(
    state: K,
    handler: (scope: Scope) => Awaitable<void> | Promise<unknown>,
    scope: Scope,
    token: Token,
    resolve: (ret: Ret) => void,
    reject: (reason: unknown) => void,
    tokenControllers: Set<TokenController> | undefined,
  ): void {
    const index = this.#stateIndices[state];

    let ctrl: TokenController | undefined;

    const alreadyStarted = index !== undefined && this.#current >= index;

    if (alreadyStarted) {
      ctrl = Token.createController();
      tokenControllers?.add(ctrl);
      scope.runCancellable(({ scope }) => handler(scope), { token: ctrl.token }).catch(reject);
    }

    token.add(
      this.#eventEmitter.add(async item => {
        if (item.event === 'return') return resolve(item.value);
        if (item.event === 'throw') return reject(item.error);

        if (item.state !== state) return;

        const oldCtrl = ctrl;
        if (oldCtrl) {
          tokenControllers?.delete(oldCtrl);
        }

        if (item.event === 'exit') {
          return oldCtrl?.cancel().finally(() => {
            if (ctrl === oldCtrl) {
              ctrl = undefined;
              tokenControllers?.delete(oldCtrl);
            }
          });
        }

        const newCtrl = Token.createController();
        ctrl = newCtrl;

        if (oldCtrl) {
          tokenControllers?.delete(oldCtrl);
          newCtrl.token.add(oldCtrl);
          await oldCtrl.cancel(new CancellationError());
        }

        tokenControllers?.add(newCtrl);

        await scope.runCancellable(({ scope }) => handler(scope), { token: ctrl.token }).catch(reject);
      }),
    );
  }

  override in(handlers: LifecycleHandlers<K>, options?: CancellableOptions): Promise<Ret> {
    const keys = [...Object.keys(handlers), ...Object.getOwnPropertySymbols(handlers)] as K[];
    return this.#scope.launch(
      ({ scope }) =>
        new Promise((resolve, reject) => {
          const tokenControllers = new Set<TokenController>();
          let handlerAdded = false;

          const _scope = scope.token.isDefused ? scope : scope.replaceToken(Token.static);

          scope.token.add(error => {
            const controllers = Array.from(tokenControllers).reverse();
            tokenControllers.clear();
            const errors = new Set<unknown>();

            return cascadeSync<undefined>(
              undefined,
              controllers.map(ctrl => () => {
                try {
                  return ctrl.tryCancelSync(error)?.then(
                    () => undefined,
                    e => void errors.add(e),
                  );
                } catch (e) {
                  errors.add(e);
                }
              }),
            );
          });

          for (const key of keys) {
            const handler = handlers[key];
            if (!handler) continue;
            handlerAdded = true;

            this.#in(
              key,
              scope => handler(scope.getContext()),
              _scope,
              scope.token,
              resolve,
              reject,
              tokenControllers,
            );
          }

          if (!handlerAdded) {
            scope.token.add(
              this.#eventEmitter.add(item => {
                if (item.event === 'return') return resolve(item.value);
                if (item.event === 'throw') return reject(item.error);
              }),
            );
          }
        }),
      { scope: options },
    );
  }

  override flowIn(state: K): Flow<undefined, Ret, unknown> {
    if (this.#ret?.event === 'return') return emptyFlow(this.#ret.value);
    if (this.#ret) return failedFlow(this.#ret.error);

    return defineFlow(
      ({ emitScoped, scope }) =>
        new Promise((resolve, reject) =>
          this.#in(
            state,
            scope => emitScoped({ value: undefined, scope }),
            scope,
            scope.token,
            resolve,
            reject,
            undefined,
          ),
        ),
    );
  }

  static readonly Controller = class Controller<K extends PropertyKey, Ret> implements LifecycleController<
    K,
    Ret
  > {
    #updater;
    #emit: ((event: LifecycleControllerEvent<K, Ret>) => Promise<void>) | undefined;
    #states;
    #stateIndices;
    #scope: Scope;
    readonly lifecycle;

    constructor(states: readonly K[], scope: Scope) {
      this.#scope = scope;
      this.#states = states;
      const stateIndices: Partial<Record<K, number>> = {};

      {
        let i = 0;
        for (const state of states) {
          stateIndices[state] = i++;
        }
      }

      this.#stateIndices = stateIndices;

      const event = GenericEventEmitter.createController<
        LifecycleControllerEvent<K, Ret>,
        Awaitable<void>,
        true
      >({ isAsync: true });
      this.#emit = event.emitAllAsync;

      this.lifecycle = new ControllableLifecycle(event.emitter, stateIndices, scope);

      this.#updater = latestUpdater(this.#setLevel.bind(this));

      scope.token.add(error => this.#updater.update(-1, { event: 'throw', error }));
    }

    #setLevel(newLevel: number, term?: LifecycleTermination<Ret>): Promise<undefined> {
      return this.#scope.runCancellable(async ({ scope }): Promise<undefined> => {
        const emit = this.#emit;

        if (!emit) return;

        while (newLevel > this.lifecycle.#current) {
          const state = this.#states[++this.lifecycle.#current];
          if (state === undefined) continue;

          await scope.run(() => emit({ event: 'enter', state }));
        }

        while (newLevel < this.lifecycle.#current) {
          const state = this.#states[this.lifecycle.#current--];
          if (state === undefined) continue;

          await scope.run(() => emit({ event: 'exit', state }));
        }

        if (term) {
          this.#emit = undefined;
          void emit(term);
        }
      });
    }

    readonly setState = (state: K | undefined): Promise<undefined> => {
      const level = state === undefined ? -1 : this.#stateIndices[state];

      if (level === undefined) return Promise.resolve(undefined);

      return this.#updater.update(level);
    };

    readonly abort = (reason: unknown = new CancellationError()) =>
      void this.#updater.update(-1, { event: 'throw', error: toErrorForCancellation(reason) });

    readonly close = (value: Ret) => void this.#updater.update(-1, { event: 'return', value });

    [Symbol.dispose]() {
      void this.#updater.update(-1, { event: 'throw', error: new CancellationError() });
    }

    [Symbol.asyncDispose]() {
      return this.#updater.update(-1, { event: 'throw', error: new CancellationError() });
    }
  };
}

export interface LifecycleControllerOptions<_K extends PropertyKey, _Ret> extends CancellableOptions {
  // onStart?:
  //   | ((
  //       cx: ScopeContext<LifecycleController<K, Ret> & { controller: LifecycleController<K, Ret> }>,
  //     ) => Awaitable<void>)
  //   | undefined;
  // onResume?:
  //   | ((
  //       cx: ScopeContext<LifecycleController<K, Ret> & { controller: LifecycleController<K, Ret> }>,
  //     ) => Awaitable<void>)
  //   | undefined;
}

/**
 * Creates a {@link LifecycleController} for a {@link GenericLifecycle} with the given states.
 * @params states - The list of possible states
 */
export const createLifecycleController = <K extends PropertyKey, Ret = void>(
  states: readonly K[],
  options?: LifecycleControllerOptions<K, Ret>,
): LifecycleController<K, Ret> => {
  const scope = Scope.from(options);

  const { error } = scope.token;

  if (error) {
    return {
      abort: () => undefined,
      close: () => undefined,
      setState: () => Promise.resolve(undefined),
      lifecycle: abortedLifecycle(error),
      [Symbol.dispose]: () => undefined,
      [Symbol.asyncDispose]: () => Promise.resolve(undefined),
    };
  }

  return new ControllableLifecycle.Controller(states, scope);
};

/** Creates a {@link LifecycleController} for a {@link StandardLifecycle}. */
export const standardLifecycleController = <Ret = void>(
  options?: CancellableOptions,
): LifecycleController<StandardLifecycleState, Ret> =>
  createLifecycleController(['created', 'started', 'resumed'], options);
