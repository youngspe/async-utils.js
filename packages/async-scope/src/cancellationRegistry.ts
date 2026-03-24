import { CancellationError, toError } from './error.ts';
import {
  type CancellableOrDisposable,
  type CancellableParentHandle,
  type Cancellable,
  cancelObject,
  CancellationSource,
} from './scope.ts';
import Symbols from './symbols.ts';
import { joinPromisesAggregatingErrors } from './utils.ts';

namespace RegistryState {
  export interface Initial {
    status: 'initial';
    listeners: Map<object, CancellableOrDisposable>;
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

export interface CancellationController extends Cancellable {
  cancel(reason?: unknown): Promise<void>;
  defuse(): void;
}

export class CancellationRegistry extends CancellationSource {
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

  private constructor() {
    super();
    this.#state = {
      status: 'initial',
      listeners: new Map(),
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

  throwIfCancelled(): void {
    if (this.#state.status === 'cancelled') throw this.#state.reason;
  }

  protected override addOne(target: CancellableOrDisposable) {
    const state = this.#state;
    const key = target;
    if (state.status !== 'initial' || state.listeners.has(key)) return;

    state.listeners.set(key, target);
    const shouldAdd = target[Symbols.cancellableAdded]?.(state.handle) !== false;

    if (!shouldAdd) {
      state.listeners.delete(key);
    }
  }

  protected override removeOne(key: object) {
    const state = this.#state;
    if (state.status !== 'initial') return;

    const target = state.listeners.get(key);
    if (!target) return;

    state.listeners.delete(key);
    target[Symbols.cancellableRemoved]?.(state.handle);
  }

  static readonly #Controller = class _Controller implements CancellationController {
    #registry;

    constructor(registry: CancellationRegistry) {
      this.#registry = registry;
    }

    async cancel(reason: unknown = new CancellationError()): Promise<void> {
      const state = this.#registry.#state;
      if (state.status === 'cancelled') return state.completed;
      if (state.status !== 'initial') return;

      const error = toError(reason);

      const { promise, resolve } = Promise.withResolvers<void>();
      this.#registry.#state = { status: 'cancelled', reason: error, completed: promise };

      for (const parent of state.parents) {
        parent.remove(this);
      }

      const promises = Array.from(state.listeners.values(), l => cancelObject(l, error));

      resolve(joinPromisesAggregatingErrors(promises).then(() => undefined));
      return promise;
    }

    defuse() {
      const state = this.#registry.#state;
      if (state.status !== 'initial') return;

      this.#registry.#state = { status: 'defused' };

      for (const parent of state.parents) {
        parent.remove(this);
      }

      for (const listener of state.listeners.values()) {
        listener[Symbols.cancellableRemoved]?.(state.handle);
      }
    }

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
  };

  static withController(): { registry: CancellationRegistry; controller: CancellationController } {
    const registry = new CancellationRegistry();
    return { registry, controller: new CancellationRegistry.#Controller(registry) };
  }
}
