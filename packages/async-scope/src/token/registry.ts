import { CancellationError, combineErrors, toError } from '../error.ts';
import {
  type CancellableOrDisposable,
  type CancellableParentHandle,
  type Cancellable,
  cancelObject,
} from '../cancel.ts';
import { Token } from '../token.ts';
import Symbols from '../symbols.ts';
import { joinPromisesAggregatingErrors, TODO } from '../utils.ts';

namespace RegistryState {
  export interface Initial {
    status: 'initial';
    listeners: WeakRef<Map<object, CancellableOrDisposable>>;
    parents: Set<CancellableParentHandle>;
    handle: CancellableParentHandle;
  }

  export interface Defused {
    status: 'defused';
  }

  export interface Cancelled {
    status: 'cancelled';
    reason: Error;
    completed: Promise<void>;
  }
}
type RegistryState = RegistryState.Initial | RegistryState.Defused | RegistryState.Cancelled;

export interface CancellationController extends Cancellable, AsyncDisposable {
  cancel(this: void, reason?: unknown): Promise<void>;
  defuse(this: void): void;
}

export class CancellationRegistry extends Token {
  static readonly #controllerDroppedRegistry = new FinalizationRegistry<CancellationController>(ctrl => {
    ctrl.defuse();
  });

  #state: RegistryState;

  static readonly #Handle = class _Handle implements CancellableParentHandle {
    #registry: WeakRef<CancellationRegistry>;

    constructor(registry: CancellationRegistry) {
      this.#registry = new WeakRef(registry);
    }

    remove(key: object): void {
      const registry = this.#registry.deref();

      if (!registry) return;

      registry.removeOne(key);
    }

    isValid(): boolean {
      const registry = this.#registry.deref();

      if (!registry) return false;

      return registry.#state.status === 'cancelled';
    }
  };

  private constructor(listeners: WeakRef<Map<object, CancellableOrDisposable>>) {
    super();
    this.#state = {
      status: 'initial',
      listeners,
      parents: new Set(),
      handle: new CancellationRegistry.#Handle(this),
    };
  }

  override get isCancelled(): boolean {
    return this.#state.status === 'cancelled';
  }

  override get isDefused(): boolean {
    return this.#state.status === 'defused';
  }

  override get error(): Error | undefined {
    return this.#state.status === 'cancelled' ? this.#state.reason : undefined;
  }

  protected override addOne(listener: CancellableOrDisposable) {
    const state = this.#state;
    const key = listener;
    if (state.status !== 'initial') return;

    const listeners = state.listeners.deref();

    if (!listeners || listeners.has(key)) return;

    listeners.set(key, listener);
    const shouldAdd = listener[Symbols.cancellableAdded]?.(state.handle) !== false;

    if (!shouldAdd) {
      listeners.delete(key);
    }
  }

  protected override removeOne(key: object) {
    const state = this.#state;
    if (state.status !== 'initial') return;

    const listeners = state.listeners.deref();
    if (!listeners) return;

    const listener = listeners.get(key);
    if (!listener) return;

    listeners.delete(key);
    listener[Symbols.cancellableRemoved]?.(state.handle);
  }

  static readonly #Controller = class _Controller implements CancellationController {
    #registry;
    #listeners: Map<object, CancellableOrDisposable> | undefined;
    #options;

    constructor(
      registry: CancellationRegistry,
      listeners: Map<object, CancellableOrDisposable>,
      options?: Token.CreateWithControllerOptions,
    ) {
      this.#registry = registry;
      this.#listeners = listeners;
      this.#options = options;
    }

    readonly cancel: (this: void, reason?: unknown) => Promise<void> = async (reason?) => {
      const options = this.#options;
      this.#options = undefined;

      const state = this.#registry.#state;
      const listeners = this.#listeners;
      if (state.status === 'cancelled') return state.completed;
      if (state.status !== 'initial' || !listeners) return;

      CancellationRegistry.#controllerDroppedRegistry.unregister(this);

      const error = toError(reason);

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      this.#registry.#state = { status: 'cancelled', reason: error, completed: promise };
      this.#listeners = undefined;

      for (const parent of state.parents) {
        parent.remove(this);
      }

      let beforeFailed = false;
      let beforeError: unknown;

      if (options?.onBeforeCancel) {
        try {
          await options.onBeforeCancel(error);
        } catch (e) {
          beforeFailed = true;
          beforeError = e;
        }
      }

      const promises = Array.from(listeners.values(), l => cancelObject(l, error));
      listeners.clear();

      const joinResult = await joinPromisesAggregatingErrors(promises);
      let errorSet = joinResult.err;

      if (beforeFailed) {
        (errorSet ??= new Set()).add(beforeError);
      }

      if (options?.onAfterCancel) {
        try {
          await options.onAfterCancel(error);
        } catch (e) {
          (errorSet ??= new Set()).add(e);
        }
      }

      if (errorSet?.size) {
        reject(combineErrors(errorSet));
      } else {
        resolve();
        return promise;
      }
    };

    readonly defuse: (this: void) => void = () => {
      const options = this.#options;
      this.#options = undefined;

      const state = this.#registry.#state;
      const listeners = this.#listeners;
      if (state.status !== 'initial' || !listeners) return;

      CancellationRegistry.#controllerDroppedRegistry.unregister(this);

      this.#registry.#state = { status: 'defused' };
      this.#listeners = undefined;

      for (const parent of state.parents) {
        parent.remove(this);
      }

      for (const listener of listeners.values()) {
        listener[Symbols.cancellableRemoved]?.(state.handle);
      }

      listeners.clear();

      options?.onDefuse?.();
    };

    [Symbols.cancellableAdded](handle: CancellableParentHandle) {
      const state = this.#registry.#state;

      if (state.status !== 'initial') return false;

      state.parents.add(handle);
    }

    [Symbols.cancellableRemoved](handle: CancellableParentHandle) {
      const state = this.#registry.#state;

      if (state.status !== 'initial') return;

      state.parents.delete(handle);
    }

    [Symbol.asyncDispose]() {
      return this.cancel();
    }
  };

  static createPair(options?: Token.CreateWithControllerOptions): {
    token: CancellationRegistry;
    controller: CancellationController;
  } {
    const listeners = new Map<object, CancellableOrDisposable>();
    const registry = new CancellationRegistry(new WeakRef(listeners));
    const controller = new CancellationRegistry.#Controller(registry, listeners, options);
    CancellationRegistry.#controllerDroppedRegistry.register(listeners, controller, controller);

    return { token: registry, controller };
  }
}
