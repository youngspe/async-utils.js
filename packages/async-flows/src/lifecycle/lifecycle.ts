import {
  CancellationError,
  toErrorForCancellation,
  Token,
  type CancellableOptions,
  type ScopeContext,
} from '@youngspe/async-scope';
import type { Awaitable, CancellationTokenBase } from '@youngspe/async-scope-common';

import { emptyFlow, failedFlow, type Flow } from '#pkg/flow';
export type LifecycleHandlers<K extends PropertyKey = StandardLifecycleState> = {
  [_ in K]?: ((cx: ScopeContext) => Awaitable<void>) | undefined;
};

export interface LifecycleEvent<K extends PropertyKey> {
  event: 'enter' | 'exit';
  state: K;
}

export type LifecycleTermination<Ret> = { event: 'return'; value: Ret } | { event: 'throw'; error: Error };

/**
 * Represents the lifecycle of some entity using a hierarchy of possible states.
 */
export abstract class GenericLifecycle<in K extends PropertyKey, out Ret = unknown> {
  /**
   * Calls the provided functions when their associated state begins, in a scope that closes when
   * the state ends.
   */
  abstract in(handlers: LifecycleHandlers<K>, options?: CancellableOptions): Promise<Ret>;
  /** Creates a flow that yields `void` when the requested state is active. */
  abstract flowIn(state: K): Flow<void, Ret, unknown>;
  /**
   * Calls the provided function when the requested state begins, in a scope that closes when the
   * state ends.
   */
  on(state: K, handler: (cx: ScopeContext) => Awaitable<void>, options?: CancellableOptions): Promise<Ret> {
    return this.in({ [state]: handler } as LifecycleHandlers<K>, options);
  }
}

/** Lifecycle that is already closed or aborted. */
class TerminatedLifecycle<Ret> extends GenericLifecycle<PropertyKey, Ret> {
  #term: LifecycleTermination<Ret>;
  #token;

  constructor(term: LifecycleTermination<Ret>, token: CancellationTokenBase | undefined) {
    super();

    this.#term = term;
    this.#token = token;
  }

  #inner(options?: CancellableOptions): LifecycleTermination<Ret> {
    const term = this.#term;

    if (term.event === 'throw') return term;

    if (this.#token) {
      const { error } = this.#token;

      if (error) {
        this.#token = undefined;
        return (this.#term = { event: 'throw', error });
      }

      if (this.#token.isDefused) {
        this.#token = undefined;
      }
    }

    if (!options) return term;

    const { error } = Token.from(options);

    return error ? { event: 'throw', error } : term;
  }
  override in(_: unknown, options?: CancellableOptions): Promise<Ret> {
    const term = this.#inner(options);

    return term.event === 'return' ? Promise.resolve(term.value) : Promise.reject(term.error);
  }
  override flowIn(_: unknown): Flow<void, Ret, unknown> {
    const term = this.#inner();

    if (term.event === 'throw') return failedFlow(term.error);

    const flow = emptyFlow(term.value);

    return this.#token ? flow.inScope(this.#token) : flow;
  }
}

/** Creates a {@link GenericLifecycle} that has already been aborted. */
export function abortedLifecycle(
  reason: unknown = new CancellationError(),
): GenericLifecycle<PropertyKey, never> {
  return new TerminatedLifecycle({ event: 'throw', error: toErrorForCancellation(reason) }, undefined);
}

/** Creates a {@link GenericLifecycle} that has already been closed. */
export function closedLifecycle<Ret = void>(
  value: Ret,
  options?: CancellableOptions,
): GenericLifecycle<PropertyKey, Ret> {
  const token = options && Token.from(options);

  if (token?.error) return abortedLifecycle(token.error);

  return new TerminatedLifecycle({ event: 'return', value }, token?.isDefused ? undefined : token);
}

/** The possible states for a {@link StandardLifecycle}. */
export type StandardLifecycleState = 'created' | 'started' | 'resumed';

/**
 * A lifecycle with the following states:
 *
 * - `created`: an entity has been created. After this state has ended, it should not be restarted.
 * - `started`: an entity is now fully initialized
 * - `resumed`: an entity is ready to be interacted with
 */
export interface StandardLifecycle<Ret = unknown> extends GenericLifecycle<StandardLifecycleState, Ret> {}
