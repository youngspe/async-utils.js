import {
  type CancellableOptions,
  CancellationError,
  type EventControllerLike,
  type GenericEventController,
  GenericEventEmitter,
  Scope,
  type ScopeContext,
  Subscription,
  type SubscriptionLifecycle,
  Token,
  type TokenController,
  toErrorForCancellation,
} from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';
import { isPromiseLike } from '@youngspe/common-async-utils';

import { ControlFlow } from '../controlFlow.ts';
import { Flow, FlowComplete, NewItemReceived } from '../flow.ts';

export interface StateFlowController<in T extends TOut, out TOut = unknown> extends Disposable {
  stateFlow: StateFlow<TOut>;
  set: (this: void, value: Awaitable<T>) => void;
  unset: (this: void) => void;
  cancel: (this: void, reason?: unknown) => void;
}

interface CreateStateFlowOptions<T>
  extends
    SubscriptionLifecycle<[ctrl: StateFlowController<T>], [ctrl: StateFlowController<T>]>,
    CancellableOptions {}

const CONTROLLER_CANCEL_SENTINEL = Symbol('CONTROLLER_CANCEL_SENTINEL');

export abstract class StateFlow<out T> extends Flow<T, never, unknown> {
  abstract getValue(options?: CancellableOptions): Promise<T>;

  abstract get latest(): T | undefined;

  static fromFlow<T>(
    this: void,
    src: Flow<T, unknown, undefined>,
    options?: CancellableOptions,
  ): StateFlow<T> {
    const ctrl = StateFlow.createController<T>({ token: options });

    let sub: Subscription | undefined;

    src
      .each(
        ({ value, token }) => {
          sub?.dispose();
          sub = token.add(error => {
            sub = undefined;
            if (error instanceof FlowComplete) return;
            if (error instanceof NewItemReceived && !error.deferred) return;

            ctrl.unset();
          });

          ctrl.set(value);
        },
        { token: options },
      )
      .catch(ctrl.cancel);

    return ctrl.stateFlow;
  }

  static createController<T>(this: void, options?: CreateStateFlowOptions<T>): StateFlowController<T, T> {
    const scope = Scope.from(options);
    const { token } = scope;
    const { error } = token;

    if (error)
      return {
        stateFlow: new CancelledStateFlow(error),
        set: () => {},
        unset: () => {},
        cancel: () => {},
        [Symbol.dispose]: () => {},
      };

    const { init } = options ?? {};

    return GenericEventEmitter.createController({
      context: (ctrl: GenericEventController<FlowState<T>>) => new StateFlow.#Controller<T>(ctrl, scope),
      init: ({ context }) => {
        const { error } = token;
        if (error) {
          context.cancel(error);
          return;
        }

        const sub = token.add(context);

        const _init = init?.(context);

        return {
          resume: _init?.resume && (({ context }) => _init.resume?.(context)),
          close: () => {
            sub?.dispose();
            _init?.close?.();
          },
        };
      },
      dispose: options?.dispose,
    }).context;
  }
  static create<T>(this: void, options: CreateStateFlowOptions<T>): StateFlow<T> {
    return StateFlow.createController(options).stateFlow;
  }

  static readonly #Controller = class Controller<T> implements StateFlowController<T> {
    #inner: EventControllerLike<FlowState<T>> | undefined;
    #cancelPromise: ((value: typeof CONTROLLER_CANCEL_SENTINEL) => void) | undefined;
    readonly stateFlow;

    constructor(inner: GenericEventController<FlowState<T>>, scope: Scope) {
      this.#inner = inner;
      this.stateFlow = new DefaultStateFlow(inner.emitter, scope);
    }

    #emit(state: FlowState<T>) {
      this.#cancelPromise?.(CONTROLLER_CANCEL_SENTINEL);
      this.#cancelPromise = undefined;
      if (!this.#inner) return;
      using ls = this.#inner.getListeners();

      for (const listener of ls.listeners()) {
        listener(state);
      }
    }

    set = (value: Awaitable<T>) => {
      if (!isPromiseLike(value)) {
        this.#emit({ status: 'ready', value });
        return;
      }

      Promise.race([
        value,
        new Promise<typeof CONTROLLER_CANCEL_SENTINEL>(r => {
          this.#cancelPromise = r;
        }),
      ]).then(value => {
        if (value === CONTROLLER_CANCEL_SENTINEL) return;

        this.#emit({ status: 'ready', value });
      }, this.cancel);
    };

    unset = () => {
      this.#emit({ status: 'pending' });
    };

    cancel = (reason: unknown = new CancellationError()) => {
      this.#emit({ status: 'error', error: toErrorForCancellation(reason) });
      this.#inner?.dispose();
      this.#inner = undefined;
    };

    [Symbol.dispose] = this.cancel;
  };
}

type FlowState<T> =
  | { status: 'error'; error: Error }
  | { status: 'ready'; value: T }
  | { status: 'pending' };

class CancelledStateFlow<T> extends StateFlow<T> {
  #error: Error;

  constructor(error: Error) {
    super();
    this.#error = error;
  }

  override getValue() {
    return Promise.reject(this.#error);
  }

  override get latest() {
    return undefined;
  }

  override tryEach() {
    return Promise.reject(this.#error);
  }
}

class DefaultStateFlow<T> extends StateFlow<T> {
  #state: FlowState<T> = { status: 'pending' };
  #readyEvent: GenericEventEmitter<FlowState<T>>;
  #scope: Scope;

  constructor(readyEvent: GenericEventEmitter<FlowState<T>>, scope: Scope) {
    super();
    this.#readyEvent = readyEvent;
    this.#readyEvent.add(
      state => {
        this.#state = state;
      },
      { passive: true },
    );
    this.#scope = scope;
  }

  override async getValue(options?: CancellableOptions) {
    const out = await this.tryEach(({ value }) => ({ break: value }), { scope: options });
    return out.continue ?? out.break;
  }

  override get latest() {
    if (this.#state.status !== 'ready') return undefined;
    return this.#state.value;
  }

  override async tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<void>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, never>> {
    if (this.#state.status === 'error') throw this.#state.error;
    const outerCtrl = Token.createController();

    return this.#scope.launch(
      async ({ scope }) => {
        let controller: TokenController | undefined;
        let resolve: (() => void) | undefined;
        let state: FlowState<T> | undefined = this.#state;

        this.#readyEvent.add(
          s => {
            state = s;
            const _resolve = resolve;
            resolve = undefined;
            if (_resolve) {
              _resolve();
            } else {
              controller
                ?.cancel(s.status === 'error' ? s.error : new NewItemReceived(s.status === 'pending'))
                .catch(outerCtrl.cancel)
                .finally(() => {
                  controller = undefined;
                });
            }
          },
          { scope },
        );

        while (true) {
          while (state) {
            const _state: FlowState<T> = state;
            state = undefined;

            switch (_state.status) {
              case 'pending': {
                await controller?.cancel(new NewItemReceived(true));
                controller = undefined;

                break;
              }
              case 'ready': {
                await controller?.cancel(new NewItemReceived(false));
                controller = scope.use(Token.createController());
                let out;
                try {
                  out = await ControlFlow.fromAsync(
                    handler(scope.getContext({ values: { value: _state.value }, token: controller })),
                  );
                } catch (error) {
                  if (!controller.token.isCancelled) throw error;
                  await controller.cancel();
                }

                if (out && !('continue' in out)) return out;
                break;
              }
              case 'error': {
                await controller?.cancel(_state.error);
                controller = undefined;
                throw _state.error;
              }
            }
          }

          let rejectSub: Subscription | undefined;

          await new Promise<void>((_resolve, reject) => {
            resolve = _resolve;
            rejectSub = scope.token.add(reject);
          });

          rejectSub?.dispose();
          resolve = undefined;
        }
      },
      { scope: [options, outerCtrl] },
    );
  }
}
