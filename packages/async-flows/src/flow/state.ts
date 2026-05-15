import {
  type CancellableOptions,
  CancellationError,
  type GenericEventEmitter,
  Scope,
  type ScopeContext,
  Subscription,
  toErrorForCancellation,
  type Token,
} from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';
import { isPromiseLike } from '@youngspe/common-async-utils';

import { ControlFlow } from '#pkg/controlFlow';
import {
  sharedFlowController,
  type SharedFlowController,
  isNonDeferredFlowError,
  defineFlow,
} from '#pkg/flow';
import { latest } from '#pkg/flow/ops/latest';

import { Flow } from './flow.ts';

export interface StateFlowController<in T extends TOut, out TOut = unknown> extends Disposable {
  stateFlow: StateFlow<TOut>;
  set: (this: void, value: Awaitable<T>) => void;
  unset: (this: void) => void;
  cancel: (this: void, reason?: unknown) => void;
}

export interface StateFlowOptions<T, K = T> {
  getKey?: ((this: void, value: T) => K) | undefined;
  eq?: ((this: void, oldKey: K, newKey: K) => boolean) | undefined;
}

export interface CreateStateFlowOptions<T, K = T> extends CancellableOptions, StateFlowOptions<T, K> {
  onInit?:
    | ((
        this: void,
        cx: ScopeContext<StateFlowController<T> & { controller: StateFlowController<T> }>,
      ) => Awaitable<void>)
    | undefined;
  onStart?:
    | ((
        this: void,
        cx: ScopeContext<StateFlowController<T> & { controller: StateFlowController<T> }>,
      ) => Awaitable<void>)
    | undefined;
  onResume?:
    | ((
        this: void,
        cx: ScopeContext<StateFlowController<T> & { controller: StateFlowController<T> }>,
      ) => Awaitable<void>)
    | undefined;
}

const CONTROLLER_CANCEL_SENTINEL = Symbol('CONTROLLER_CANCEL_SENTINEL');

export abstract class StateFlow<out T> extends Flow<T, never, unknown> {
  abstract getValue(options?: CancellableOptions): Promise<T>;

  abstract get latest(): T | undefined;

  static fromFlow<T, K = T>(
    this: void,
    src: Flow<T, unknown, undefined>,
    options?: CancellableOptions & StateFlowOptions<T, K>,
  ): StateFlow<T> {
    const ctrl = StateFlow.createController<T, K>(options);

    let sub: Subscription | undefined;

    src
      .each(
        ({ value, token }) => {
          sub?.dispose();
          sub = token.add(error => {
            sub = undefined;
            if (isNonDeferredFlowError(error)) return;

            ctrl.unset();
          });

          ctrl.set(value);
        },
        { token: options },
      )
      .catch(ctrl.cancel);

    return ctrl.stateFlow;
  }

  static createController<T, K = T>(
    this: void,
    options?: CreateStateFlowOptions<T, K>,
  ): StateFlowController<T, T> {
    const scope = Scope.from(options);
    const { error } = scope.token;

    if (error)
      return {
        stateFlow: new CancelledStateFlow(error),
        set: () => {},
        unset: () => {},
        cancel: () => {},
        [Symbol.dispose]: () => {},
      };

    return new DefaultStateFlow.Controller(options ?? {}, scope);
  }

  static create<T, K>(this: void, options: CreateStateFlowOptions<T, K>): StateFlow<T> {
    return StateFlow.createController(options).stateFlow;
  }
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
  #values;
  #scope;

  constructor(values: Flow<T, never, unknown>, scope: Scope | undefined) {
    super();
    this.#values = values;
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

  override tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<void>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, never>> {
    const state = this.#state;

    if (state.status === 'error') return Promise.reject(state.error);

    return this.#values.tryEach(handler, options);
  }

  static readonly Controller = class Controller<T, K = T> implements StateFlowController<T> {
    #cancelPromise: ((value: typeof CONTROLLER_CANCEL_SENTINEL) => void) | undefined;
    #setPromise: ((value: T) => void) | undefined;
    readonly stateFlow: DefaultStateFlow<T>;
    #emitter: SharedFlowController<T, never> | undefined;

    #getKey;
    #eq;
    #key: { value: K } | undefined;

    constructor(options: CreateStateFlowOptions<T, K>, scope: Scope) {
      this.#eq = options.eq;
      this.#getKey = options.getKey;

      const { onInit, onStart, onResume } = options;

      const inner = sharedFlowController<T, never>({
        scope,
        replay: 1,
        preserveReplay: true,
        onInit:
          onInit && (({ scope }) => onInit(scope.getContext({ values: { ...this, controller: this } }))),
        onStart: ({ scope }) => {
          scope.token.add(this.unset);
          return onStart?.(scope.getContext({ values: { ...this, controller: this } }));
        },
        onResume:
          onResume
          && (({ scope }) => onResume(scope.getContext({ values: { ...this, controller: this } }))),
      });

      this.#emitter = inner;

      this.stateFlow = new DefaultStateFlow(inner.flow.do(latest()), scope);
    }

    #cancelPending() {
      this.#cancelPromise?.(CONTROLLER_CANCEL_SENTINEL);
      this.#cancelPromise = undefined;
    }

    #set(value: T) {
      const emitter = this.#emitter;
      if (!emitter) return;

      const newKey = this.#getKey ? this.#getKey(value) : (value as T & K);

      if (this.#key) {
        const oldKey = this.#key.value;

        const isEqual = this.#eq ? this.#eq(oldKey, newKey) : oldKey === newKey;

        if (isEqual) return;
      }

      this.stateFlow.#state = { status: 'ready', value };

      if (this.#setPromise) {
        this.#setPromise(value);
      } else {
        void emitter.emit(value);
      }
    }

    set = (value: Awaitable<T>) => {
      if (!this.#emitter) return;

      this.#cancelPending();

      if (!isPromiseLike(value)) {
        void this.#set(value);
        return;
      }

      this.unset();

      Promise.race([
        value,
        new Promise<typeof CONTROLLER_CANCEL_SENTINEL>(r => {
          this.#cancelPromise = r;
        }),
      ]).then(value => {
        if (value === CONTROLLER_CANCEL_SENTINEL) return;
        void this.#set(value);
      }, this.cancel);
    };

    unset = () => {
      const inner = this.#emitter;
      if (!inner) return;
      this.#cancelPending();
      if (this.#setPromise) return;

      this.stateFlow.#state = { status: 'pending' };
      void inner.emit(
        new Promise(resolve => {
          this.#setPromise = resolve;
        }),
      );
    };

    cancel = (reason: unknown = new CancellationError()) => {
      const emitter = this.#emitter;
      if (!emitter) return;
      this.#cancelPending();
      const error = toErrorForCancellation(reason);
      this.stateFlow.#state = { status: 'error', error };
      emitter.fail(error);
    };

    [Symbol.dispose] = this.cancel;
  };
}
