import { ScopeBase } from '@youngspe/async-scope-common';
import {
  isAsyncIterable,
  isIterable,
  isPromiseLike,
  type ValueOrFunction,
} from '@youngspe/common-async-utils';

import type {
  Awaitable,
  BetterOmit,
  Falsy,
  OptionalUndefinedParams,
  PartialOrUndefined,
  SetProps,
  UndefinedIfDefault,
  UpdateObject,
} from '../types.ts';
import { Token, STATIC_TOKEN } from '../token.ts';
import { type CancellableOptions } from '../cancel.ts';
import { scopeFrom } from './from.ts';
import type { CancellableLike } from '../cancel.ts';
import { ScopedResources } from '../scopedResource.ts';
import { createScopeStack, StandardScope, type ScopeStack } from '../scope.ts';
import { delay, type TimerOptions } from '../timers.ts';
import { ContextData, type ContextDataBuilder } from './context.ts';
import { CancellationError, toErrorForCancellation, unwrapCancellationError } from '../error.ts';

/**
 * Function type for use in the {@linkcode Scope#launch} and {@linkcode Scope#run} family of methods
 */
export type TaskFunction<Ret, V extends object = object> = (
  this: void,
  cx: RunContext<V>,
) => Awaitable<Ret>;

/**
 * Options common to scope-related operations
 *
 * @see {@link CancellableOptions}
 */
export interface CommonScopeOptions extends CancellableOptions {}

/** Options for {@linkcode Scope#launch} etc. that are not part of {@link CommonScopeOptions}. */
interface ScopeLaunchSpecificOptions<V extends object, V2 extends object> {
  transformScope: (scope: Scope<V>) => Scope<V2>;
}

/** {@link ScopeLaunchOptions} in the case where `V` extends `V2` */
interface ScopeLaunchOptionsBase<V extends object = object, V2 extends object = V>
  extends CommonScopeOptions, PartialOrUndefined<ScopeLaunchSpecificOptions<V, V2>> {}

/** {@link ScopeLaunchOptions} in the case where `V` does not extend `V2` */
interface ScopeLaunchOptionsRequired<V extends object = object, V2 extends object = V>
  extends CommonScopeOptions, ScopeLaunchSpecificOptions<V, V2> {}

/**
 * Options for the {@linkcode Scope#launch} and {@linkcode Scope#run} family of methods
 *
 * @interface
 */
export type ScopeLaunchOptions<V extends object = object, V2 extends object = V> =
  [V] extends [V2] ? ScopeLaunchOptionsBase<V, V2> : ScopeLaunchOptionsRequired<V, V2>;

/**
 * The parameter list for the {@linkcode Scope#launch} and {@linkcode Scope#run} family of methods
 */
export type ScopeLaunchOptionsParams<
  V extends object = object,
  V2 extends object = V,
> = OptionalUndefinedParams<[options: UndefinedIfDefault<ScopeLaunchOptions<V, V2>>]>;

/** A {@link ScopeContext} without any additional values */
export interface ScopeContextBase<out V extends object = object> {
  readonly scope: Scope<V>;
  readonly token: Token;
  readonly resources: ScopedResources;
  readonly signal: AbortSignal;
}

/**
 * A context object to be passed to a function in a scope-defined task.
 *
 * @example
 * import { Scope, type ScopeContext } from '@youngspe/async-scope';
 *
 * function runInScopeWithValue<T, Ret>
 *   scope: Scope,
 *   value: T,
 *   fn: (cx: ScopeContext<{ value: T }>) => Ret,
 * ) {
 *   return fn(scope.getContext({ values: { value }}));
 * }
 *
 * const myScope = Scope.static;
 *
 * runInScopeWithValue(myScope, 'foo', ({ value, scope }) => {
 *   // ...
 * });
 *
 * @see {@linkcode Scope.getContext()}
 */
export type ScopeContext<T extends object = object, TBase extends object = object> = BetterOmit<
  SetProps<TBase, T>,
  keyof ScopeContextBase
>
  & ScopeContextBase<TBase>;

/**
 * A specialized {@link ScopeContext} for use in {@link TaskFunction}s.
 */
export type RunContext<T extends object = object> = ScopeContext<
  { cancel: (this: void, reason?: unknown) => void; abort: (this: void, reason?: unknown) => never },
  T
>;

/**
 * A {@link Scope} represents the span of an asynchronous operation. A scope defines a context
 * within which asynchronous tasks can be launched, run, and coordinated. It provides a mechanism
 * for lifecycle management of asynchronous operations, enabling cancellation, resource
 * coordination, and context data propagation.
 *
 * ## Lifecycle Management
 *
 * A scope's lifecycle is determined by its associated {@link Token}. When the token is cancelled:
 *
 * - All running tasks within the scope and its children are cancelled
 * - The cancellation error is propagated to all subscopes
 * - Tasks can handle cancellation via their respective handlers
 *
 * ## Launch vs. Run
 *
 * - **launch**: Starts a task in a subscope that is cancelled when the task completes.
 *
 * - **run**: Similar to `launch`, but the subscope is only cancelled if a parent scope is cancelled
 *   or the task function throws or rejects.
 *   This allows work spawned by the task to continue until the parent scope closes.
 *
 * - **launchCancellable** / **runCancellable**: Like the above, but resolves to `undefined` if the
 *   task rejects or is cancelled with a {@link CancellationError}.
 *   Use this when you do not want an exception to be thrown for a cancellation not caused by
 *   an error.
 *
 * ## Nested Scopes
 *
 * When a parent scope is cancelled, all nested scopes receive the cancellation signal.
 * The cancellation is not complete until all cancellation handlers in nested scopes have
 * finished executing. This ensures that cleanup code in child tasks runs before the entire
 * operation terminates.
 *
 * ## Context Data
 *
 * Scopes can carry context data (via {@link ContextData}) that is passed to tasks through
 * {@linkcode Scope#getContext()}. This enables dependency injection patterns where tasks receive
 * services, configuration, or other contextual information.
 *
 * ## Resource Coordination
 *
 * Scopes support resource injection via {@link ScopedResources}. Resources can be provided through
 * a builder function passed to {@linkcode Scope#withResources()}, enabling dependency injection for
 * things like databases, HTTP clients, or other resources specific to the current task.
 *
 * @example
 * <caption>Usage pattern</caption>
 *
 * import { Scope, Token } from '@youngspe/async-scope';
 *
 * const ctrl = Token.createController();
 *
 * const root = Scope.from(ctrl);
 *
 * try {
 *   await root.launch({ scope, cancel, abort, resources, token, signal } => {
 *     // task receives context: cancel(), abort(), resources, context data
 *   }});
 *
 *   await root.run(({ scope, cancel, abort, resources, token, signal }) => {
 *     // Background job that runs until root scope closes
 *     return monitorForever(scope);
 *   });
 * } finally {
 *   await ctrl.cancel();
 * }
 *
 * @see {@link Token}
 * @see {@link ContextData}
 * @see {@link ScopedResources}
 */
export abstract class Scope<out V extends object = object> extends ScopeBase {
  /** The cancellation token that determines when this scope is closed. */
  abstract override get token(): Token;

  /** The resources associated with this scope. */
  abstract get resources(): ScopedResources;

  /**
   * @see {@linkcode Token#isCancelled}
   */
  get isClosed(): boolean {
    return this.token.isCancelled;
  }

  /**
   * @see {@linkcode Token#signal}
   */
  get signal(): AbortSignal {
    return this.token.signal;
  }

  /** @throws if this scope is closed. */
  throwIfClosed() {
    this.token.throwIfCancelled();
  }

  protected _onError(value: unknown): void {
    throw value;
  }

  /**
   * @see {@linkcode Token#use}
   */
  use<X>(
    value: ValueOrFunction<X & CancellableLike, [cx: ScopeContext<object, V>], X>,
    options?: CancellableOptions,
  ): X {
    const scope = options ? Scope.from<V>([this, options]) : this;
    return scope.token.use(typeof value === 'function' ? () => value(scope.getContext()) : value);
  }

  /**
   * @see {@linkcode Token#tryUse}
   */
  tryUse<X>(
    value: ValueOrFunction<X & CancellableLike, [cx: ScopeContext<object, V>], X>,
    options?: CancellableOptions,
  ): X | undefined {
    const scope = options ? Scope.from<V>([this, options]) : this;
    return scope.token.tryUse(typeof value === 'function' ? () => value(scope.getContext()) : value);
  }

  /** This scope */
  readonly scope: Scope<V> = this;

  /** Resolves the given promise, but rejects or calls `onCancel` if the scope is closed first */
  resolveOrCancel<T, U = never>(
    promise: Awaitable<T>,
    onCancel?: (error: Error) => Awaitable<U>,
  ): Promise<T | U> {
    const { token } = this;
    const { error } = token;

    if (error) {
      if (!onCancel) return Promise.reject(error);
      try {
        return Promise.resolve(onCancel(error));
      } catch (error) {
        return Promise.reject(error);
      }
    }

    if (!isPromiseLike(promise)) return Promise.resolve(promise);

    return new Promise((resolve, reject) => {
      const sub = token.add(
        onCancel ?
          error => {
            try {
              return resolve(onCancel(error));
            } catch (error) {
              return reject(error);
            }
          }
        : reject,
      );

      promise.then(
        x => {
          sub?.dispose();
          resolve(x);
        },
        e => {
          sub?.dispose();
          reject(e);
        },
      );
    });
  }

  /**
   * Resolves the given promise or `undefined` if the scope is closed first with a {@link CancellationError}
   *
   * @see {@linkcode Scope#resolveOrCancel()}
   */
  resolveOrUndefined<T>(promise: Awaitable<T>): Promise<T | undefined> {
    return this.resolveOrCancel(promise, () => undefined);
  }

  #subScope<V2 extends object = V>(token: Token, ...[options]: ScopeLaunchOptionsParams<V, V2>): Scope<V2> {
    const newScope: Scope<V> = scopeFrom<V>([this, token, options]);

    if (options?.transformScope) return options.transformScope(newScope);

    return newScope as Scope<V | V2> as Scope<V2>;
  }

  /**
   * The {@link ContextData} object that provides extra values to include in a context created for
   * this scope.
   *
   * @see {@linkcode Scope#getContext()}
   */
  get contextData(): ContextData<V> {
    return ContextData.empty as ContextData<V>;
  }

  /**   *
   * Creates a {@link ScopeContext} object based on this scope.
   *
   * @example
   * import { Scope, type ScopeContext } from '@youngspe/async-scope';
   *
   * function runInScopeWithValue<T, Ret>
   *   scope: Scope,
   *   value: T,
   *   fn: (cx: ScopeContext<{ value: T }>) => Ret,
   * ) {
   *   return fn(scope.getContext({ values: { value }}));
   * }
   *
   * const myScope = Scope.static;
   *
   * runInScopeWithValue(myScope, 'foo', ({ value, scope }) => {
   *   // ...
   * });
   *
   * @throws if this scope is closed.
   */
  getContext(options?: CancellableOptions & { values?: undefined }): ScopeContext<object, V>;
  getContext<V2 extends object = object>(options: CancellableOptions & { values: V2 }): ScopeContext<V2, V>;
  getContext<V2 extends object = V>(
    options?: CancellableOptions & { values?: V2 | undefined },
  ): ScopeContext<Partial<V2>, V>;
  getContext<V2 extends object>(options?: CancellableOptions & { values?: Partial<V2> | undefined }) {
    this.throwIfClosed();

    let scope: Scope<object> = this;
    if (options?.scope || options?.token || options?.signal) {
      scope = Scope.from([scope, options]);
      scope.throwIfClosed();
    }

    let { contextData } = scope;

    if (options?.values) {
      contextData = contextData.builder().values(options.values).finish();
    }
    const cx = new Scope.#Context(scope);
    return contextData.updateContext(cx);
  }

  /**
   * @param block - The asynchronous operation for this task.
   * @param cancelOnComplete - If `true`, the sub-scope is closed when the async operation
   *    is complete.
   * @param onCancel - Action taken on cancellation. If none provided, rejects.
   *
   * @see {@link Scope#run}
   * @see {@link Scope#runCancellable}
   * @see {@link Scope#launch}
   * @see {@link Scope#launchCancellable}
   */
  async #run<R, V2 extends object = V, R2 = never>(
    block: TaskFunction<R, V2>,
    cancelOnComplete: boolean,
    onCancel: ((error: Error) => Awaitable<R2>) | undefined,
    ...params: ScopeLaunchOptionsParams<V, V2>
  ): Promise<R | R2> {
    const { error } = this.token;

    if (error) {
      if (onCancel) return await onCancel(error);
      throw error;
    }

    await using controller = this.use(Token.createController());

    const subScope = this.#subScope<V2>(controller.token, ...params);

    let out;

    try {
      out = await subScope.resolveOrCancel(
        block(
          subScope.getContext({
            values: {
              abort: (reason: unknown = new CancellationError()) => {
                const error = toErrorForCancellation(reason);
                controller.cancel(error).catch(() => {});
                throw error;
              },
              cancel: (reason: unknown = new CancellationError()) => {
                controller.cancel(reason).catch(() => {});
              },
            },
          }),
        ),
        onCancel,
      );
    } catch (error) {
      try {
        if (onCancel && error instanceof Error && (subScope.isClosed || unwrapCancellationError(error))) {
          return await onCancel(error);
        } else {
          throw error;
        }
      } finally {
        await controller.cancel(error);
      }
    }

    if (cancelOnComplete) {
      await controller.cancel(new CancellationError());
    } else {
      controller.defuse();
    }

    return out;
  }

  /**
   * Launches a task in a subscope context. The subscope will be closed when the function completes.
   *
   * Rejects if the scope is cancelled before the function is complete.
   *
   * @param block the function to run
   * @param options
   * @returns a promise that resolves to the result of `block`, or rejects if the scope is closed first.
   */
  launch<R, V2 extends object = V>(
    block: TaskFunction<R, V2>,
    ...params: ScopeLaunchOptionsParams<V, V2>
  ): Promise<R> {
    return this.#run(block, true, undefined, ...params);
  }

  /**
   * Launches a task in a subscope context. The subscope will be closed when the function completes.
   *
   * If the scope is cancelled before the function is complete, this will resolve to `undefined`.
   *
   * @param block the function to run
   * @param options
   * @returns a promise that resolves to the result of `block`, or `undefined` if the scope is
   * closed first.
   */
  async launchCancellable<R, V2 extends object = V>(
    block: TaskFunction<R, V2>,
    ...params: ScopeLaunchOptionsParams<V, V2>
  ): Promise<R | undefined> {
    return this.#run(block, true, () => undefined, ...params);
  }

  /**
   * Runs the given function in a subscope context. If the function throws a non-cancellation error,
   * the subscope will be closed.
   *
   * Rejects if the scope is cancelled before the function is complete.
   *
   * @param block the function to run
   * @param options
   * @returns a promise that resolves to the result of `block`, or rejects if the scope is closed first.
   */
  async run<R, V2 extends object = V>(
    block: TaskFunction<R, V2>,
    ...params: ScopeLaunchOptionsParams<V, V2>
  ): Promise<R> {
    return this.#run(block, false, undefined, ...params);
  }

  /**
   *
   * Runs the given function in a subscope context. If the function throws a non-cancellation error,
   * the subscope will be closed.
   *
   * If the scope is cancelled before the function is complete, this will resolve to `undefined`.
   *
   * @param block the function to run
   * @param options
   * @returns a promise that resolves to the result of `block`, or `undefined` if the scope is
   * closed first.
   */
  async runCancellable<R, V2 extends object = V>(
    block: TaskFunction<R, V2>,
    ...params: ScopeLaunchOptionsParams<V, V2>
  ): Promise<R | undefined> {
    return this.#run(block, false, () => undefined, ...params);
  }

  /**
   * Creates a new scope based on this one, but with the resources defined using the given
   * builder function
   */
  withResources(block: (builder: ScopedResources.Builder) => ScopedResources.Builder | void): Scope<V> {
    const builder = ScopedResources.builder(this.token).inherit(this.resources);
    block(builder);
    const resources = builder.finish();

    return new StandardScope({ ...this.#parts(), resources });
  }

  /**
   * Creates a new scope based on this one, but with context data defined using the given
   * builder function or {@link ContextData}
   *
   * @see {@linkcode Scope#getContext()}
   */
  withContextData<V2 extends object>(
    block: (builder: ContextDataBuilder<V>) => ContextDataBuilder<V2>,
  ): Scope<V2>;
  withContextData<V2 extends object = V>(
    block: (builder: ContextDataBuilder<V>) => ContextDataBuilder<V2> | void,
  ): Scope<V | V2>;
  withContextData<V2 extends object>(data: ContextData<V2>): Scope<SetProps<V, V2>>;
  withContextData<V2 extends object = V>(data: ContextData<V2> | Falsy): Scope<V | SetProps<V, V2>>;
  withContextData<V2 extends object>(
    data: ((builder: ContextDataBuilder<V>) => ContextDataBuilder<V2> | void) | ContextData<V2> | Falsy,
  ): Scope<V> | Scope<SetProps<V, V2>> {
    if (!data || data === ContextData.empty) return this;

    const builder = this.contextData.builder();

    if (typeof data === 'function') {
      data(builder);
    } else {
      builder.merge(data);
    }

    return new StandardScope({ ...this.#parts(), contextData: builder.finish() });
  }

  /**
   * Creates a new scope based on this one, but with context data with values from the given object
   *
   * @see {@linkcode Scope#getContext()}
   */
  withContextValues<V2 extends object = V>(values: V2): Scope<UpdateObject<V, V2>> {
    const contextData = this.contextData.builder().values(values).finish();
    return new StandardScope({ ...this.#parts(), contextData });
  }

  /**
   * Returns a promise that resolves after the given number of milliseconds or rejects if the scope
   * is closed first.
   */
  delay(ms: number, options?: TimerOptions) {
    return delay(ms, { ...options, scope: [this, options?.scope] });
  }

  /**
   * Creates a new scope based on this one, but with the given {@link Token} instead of the
   * current token.
   */
  replaceToken(token: Token) {
    if (token === this.token) return this;
    return new StandardScope({ ...this.#parts(), token });
  }

  #runAll<T>(
    tasks:
      | Iterable<TaskFunction<T, V>, unknown, undefined>
      | AsyncIterable<TaskFunction<T, V>, unknown, undefined>
      | Record<PropertyKey, TaskFunction<T, V>>,
    cancelOnComplete: boolean,
    scope?: Scope,
  ): Promise<T[] | Record<PropertyKey, T>> {
    const isIter = isIterable(tasks);
    if (!isIter && !isAsyncIterable(tasks))
      return (async () => {
        const keys = Object.keys(tasks);
        const values = Object.values(tasks);

        const joinedValues = (await this.#runAll(values, cancelOnComplete, scope)) as T[];

        const out: Record<PropertyKey, T> = {};

        for (const [i, value] of joinedValues.entries()) {
          out[keys[i]!] = value;
        }

        return out;
      })();

    return new Promise((resolve, reject) => {
      const out: T[] = [];
      let count = 1;
      let i = 0;

      const cancel = (error: unknown) => {
        ctrl.cancel(error).then(() => reject(error), reject);
      };

      const ctrl = this.use(Token.createController());
      const _scope = this.replaceToken(ctrl.token);
      const options = { scope };

      const inner = (task: TaskFunction<T, V>) => {
        const index = i++;
        ++count;

        _scope.#run(task, cancelOnComplete, undefined, options).then(value => {
          out[index] = value;
          if (--count === 0) {
            resolve(out);
          }
        }, cancel);
      };

      if (isIter) {
        for (const task of tasks) {
          inner(task);
        }

        if (--count === 0) {
          resolve(out);
        }
      } else {
        (async () => {
          for await (const task of tasks) {
            inner(task);
          }

          if (--count === 0) {
            resolve(out);
          }
        })().catch(cancel);
      }
    });
  }

  /**
   * Starts multiple tasks with {@linkcode Scope#launch} and awaits their results.
   *
   * @example
   * <caption>Awaiting a sequence of tasks</caption>
   *
   * import assert from 'node:assert';
   * import { Scope } from '@youngspe/async-scope';
   *
   * const myScope = Scope.static;
   *
   * const [a, b, c] = await myScope.launchAll([
   *   ({ scope }) => scope.delay(10).then(() => 1),
   *   ({ scope }) => 2,
   *   async ({ scope }) => {
   *     await scope.delay(20);
   *     return 3;
   *   },
   * ]);
   *
   * assert.deepEqual([a, b, c], [1, 2, 3]);
   *
   * @example
   * <caption>Awaiting an object of tasks</caption>
   *
   * import assert from 'node:assert';
   * import { Scope } from '@youngspe/async-scope';
   *
   * const myScope = Scope.static;
   *
   * const { a, b, c } = await myScope.launchAll({
   *   a: ({ scope }) => scope.delay(10).then(() => 1),
   *   b: ({ scope }) => 2,
   *   c: async ({ scope }) => {
   *     await scope.delay(20);
   *     return 3;
   *   },
   * });
   *
   * assert.deepEqual({ a, b, c }, { a: 1, b: 2, c: 3 });
   *
   * @see {@linkcode Scope#launch}
   * @see {@linkcode Scope#runAll}
   */
  launchAll<A extends readonly any[]>(
    tasks: { [K in keyof A]: TaskFunction<A[K], V> },
    options?: CancellableOptions,
  ): Promise<A>;
  launchAll<T>(
    tasks:
      | Iterable<TaskFunction<T, V>, unknown, undefined>
      | AsyncIterable<TaskFunction<T, V>, unknown, undefined>,
    options?: CancellableOptions,
  ): Promise<T[]>;
  launchAll<A extends { readonly [k: PropertyKey]: any }>(
    tasks: { [K in keyof A]: TaskFunction<A[K], V> },
    options?: CancellableOptions,
  ): Promise<A>;
  launchAll<T>(
    tasks:
      | Iterable<TaskFunction<T, V>, unknown, undefined>
      | AsyncIterable<TaskFunction<T, V>, unknown, undefined>
      | Record<PropertyKey, TaskFunction<T, V>>,
    options?: CancellableOptions,
  ): Promise<T[] | Record<PropertyKey, T>> {
    return this.#runAll(tasks, true, options && Scope.from(options));
  }

  /**
   * Starts multiple tasks with {@linkcode Scope#run} and awaits their results.
   *
   * @example
   * <caption>Awaiting a sequence of tasks</caption>
   *
   * import assert from 'node:assert';
   * import { Scope } from '@youngspe/async-scope';
   *
   * const myScope = Scope.static;
   *
   * const [a, b, c] = await myScope.runAll([
   *   ({ scope }) => scope.delay(10).then(() => 1),
   *   ({ scope }) => 2,
   *   async ({ scope }) => {
   *     await scope.delay(20);
   *     return 3;
   *   },
   * ]);
   *
   * assert.deepEqual([a, b, c], [1, 2, 3]);
   *
   * @example
   * <caption>Awaiting an object of tasks</caption>
   *
   * import assert from 'node:assert';
   * import { Scope } from '@youngspe/async-scope';
   *
   * const myScope = Scope.static;
   *
   * const { a, b, c } = await myScope.runAll({
   *   a: ({ scope }) => scope.delay(10).then(() => 1),
   *   b: ({ scope }) => 2,
   *   c: async ({ scope }) => {
   *     await scope.delay(20);
   *     return 3;
   *   },
   * });
   *
   * assert.deepEqual({ a, b, c }, { a: 1, b: 2, c: 3 });
   *
   * @see {@linkcode Scope#run}
   * @see {@linkcode Scope#launchAll}
   */
  runAll<A extends readonly any[]>(
    tasks: { [K in keyof A]: TaskFunction<A[K], V> },
    options?: CancellableOptions,
  ): Promise<A>;
  runAll<T>(
    tasks:
      | Iterable<TaskFunction<T, V>, unknown, undefined>
      | AsyncIterable<TaskFunction<T, V>, unknown, undefined>,
    options?: CancellableOptions,
  ): Promise<T[]>;
  runAll<A extends { readonly [k: PropertyKey]: any }>(
    tasks: { [K in keyof A]: TaskFunction<A[K], V> },
    options?: CancellableOptions,
  ): Promise<A>;
  runAll<T>(
    tasks:
      | Iterable<TaskFunction<T, V>, unknown, undefined>
      | AsyncIterable<TaskFunction<T, V>, unknown, undefined>
      | Record<PropertyKey, TaskFunction<T, V>>,
    options?: CancellableOptions,
  ): Promise<T[] | Record<PropertyKey, T>> {
    return this.#runAll(tasks, false, options && Scope.from(options));
  }

  /**
   * Creates a {@link ScopeStack} bound to this scope.
   */
  createStack(options?: CancellableOptions): ScopeStack<V> {
    return createScopeStack(options ? Scope.from([this, options]) : this);
  }

  /** Returns an object with just the parts used to create a new {@linkcode StandardScope} */
  #parts() {
    return { token: this.token, resources: this.resources, contextData: this.contextData };
  }

  /**
   * Creates a scope from a scope-like value.
   *
   * This may be:
   * - A {@link Token}
   * - A {@link Scope}
   * - An AbortSignal
   * - An object with a `token`, `scope`, or `signal` property, such as
   *   {@link CancellableOptions}, {@link TokenController}, or `AbortController`
   * - A falsy value (e.g. `false` or `undefined`)
   *   - This results in {@linkcode Scope.static}
   * - A (possibly nested) array or set of any of the above
   *   - The resulting scope is closed when at least one of the items in the collection is closed.
   *
   * @see {@linkcode Token.from()}
   */
  static from<V extends object = object>(this: void, src: ToScope<V>): Scope<V> {
    return scopeFrom(src);
  }

  /**
   * An empty scope that will never be closed.
   *
   * This can be used as a starting point for launching top-level tasks.
   */
  static get static() {
    return STATIC_SCOPE;
  }

  static readonly #Context = class Context<V extends object> implements ScopeContextBase<V> {
    readonly scope: Scope<V>;
    get token() {
      return this.scope.token;
    }
    get signal() {
      return this.scope.signal;
    }
    get resources() {
      return this.scope.resources;
    }

    constructor(scope: Scope<V>) {
      this.scope = scope;
    }
  };
}

/** @see {@link Scope.static} */
class StaticScope extends Scope {
  readonly resources = ScopedResources.empty;
  override get token(): Token {
    return STATIC_TOKEN;
  }
}

/** @see {@link Scope.static} */
export const STATIC_SCOPE: Scope = new StaticScope();

/** Special case of {@link ToScope} where `V` has no required properties */
type ToScopeBase<V extends object = object> =
  | Scope<V>
  | Token
  | readonly ToScopeBase<V>[]
  | Set<ToScopeBase<V>>
  | AbortSignal
  | CancellableOptions
  | Falsy;

type ToScopeWithContext<V extends object> =
  | Scope<V>
  | readonly [ToScopeWithContext<V>, ...ToScopeBase<Partial<V>>[]]
  | (CancellableOptions & { scope: ToScopeWithContext<V> });

/**
 * A value that can be passed to {@linkcode Scope.from()} to create a new scope.
 *
 * @see {@linkcode Scope.from()}
 * @see {@linkcode Token.from()}
 */
export type ToScope<V extends object = object> = object extends V ? ToScopeBase<V> : ToScopeWithContext<V>;
