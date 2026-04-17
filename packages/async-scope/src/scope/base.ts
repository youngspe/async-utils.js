import { ScopeBase } from '@youngspe/async-scope-common';
import { isAsyncIterable, isIterable, isPromiseLike } from '@youngspe/common-async-utils';

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
import { StandardScope } from '../scope.ts';
import { delay, type TimerOptions } from '../timers.ts';
import { ContextData, type ContextDataBuilder } from './context.ts';
import { CancellationError, toErrorForCancellation, unwrapCancellationError } from '../error.ts';

export type TaskFunction<Ret, V extends object = object> = (
  this: void,
  cx: RunContext<V>,
) => Awaitable<Ret>;

export interface CommonScopeOptions extends CancellableOptions {}

interface ScopeLaunchSpecificOptions<V extends object, V2 extends object> {
  transformScope: (scope: Scope<V>) => Scope<V2>;
}

interface ScopeLaunchOptionsBase<V extends object = object, V2 extends object = V>
  extends CommonScopeOptions, PartialOrUndefined<ScopeLaunchSpecificOptions<V, V2>> {}

interface ScopeLaunchOptionsRequired<V extends object = object, V2 extends object = V>
  extends CommonScopeOptions, ScopeLaunchSpecificOptions<V, V2> {}

export type ScopeLaunchOptions<V extends object = object, V2 extends object = V> =
  [V] extends [V2] ? ScopeLaunchOptionsBase<V, V2> : ScopeLaunchOptionsRequired<V, V2>;

export type ScopeLaunchOptionsParams<
  V extends object = object,
  V2 extends object = V,
> = OptionalUndefinedParams<[options: UndefinedIfDefault<ScopeLaunchOptions<V, V2>>]>;

export interface ScopeContextBase<out V extends object = object> {
  readonly scope: Scope<V>;
  readonly token: Token;
  readonly resources: ScopedResources;
  readonly signal: AbortSignal;
}

export type ScopeContext<T extends object = object, TBase extends object = object> = BetterOmit<
  SetProps<TBase, T>,
  keyof ScopeContextBase
>
  & ScopeContextBase<T>;

export type RunContext<T extends object = object> = ScopeContext<
  { cancel: (this: void, reason?: unknown) => void; abort: (this: void, reason?: unknown) => never },
  T
>;

export abstract class Scope<out V extends object = object> extends ScopeBase {
  /** The cancellation token that determines when this scope is closed. */
  abstract override get token(): Token;

  abstract get resources(): ScopedResources;

  get isClosed(): boolean {
    return this.token.isCancelled;
  }

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
  use<T extends CancellableLike>(value: T): T {
    return this.token.use(value);
  }

  /**
   * @see {@linkcode Token#tryUse}
   */
  tryUse<T extends CancellableLike>(value: T): T | undefined {
    return this.token.tryUse(value);
  }

  /** This scope */
  readonly scope: Scope<V> = this;

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

  resolveOrUndefined<T>(promise: Awaitable<T>): Promise<T | undefined> {
    return this.resolveOrCancel(promise, () => undefined);
  }

  #subScope<V2 extends object = V>(token: Token, ...[options]: ScopeLaunchOptionsParams<V, V2>): Scope<V2> {
    const newScope: Scope<V> = scopeFrom<V>([this, token, options]);

    if (options?.transformScope) return options.transformScope(newScope);

    return newScope as Scope<V | V2> as Scope<V2>;
  }

  get contextData(): ContextData<V> {
    return ContextData.empty as ContextData<V>;
  }

  /**
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

  withResources(block: (builder: ScopedResources.Builder) => ScopedResources.Builder | void): Scope<V> {
    const builder = ScopedResources.builder(this.token).inherit(this.resources);
    block(builder);
    const resources = builder.finish();

    return new StandardScope({ ...this.#parts(), resources });
  }

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

  withContextValues<V2 extends object = V>(values: V2): Scope<UpdateObject<V, V2>> {
    const contextData = this.contextData.builder().values(values).finish();
    return new StandardScope({ ...this.#parts(), contextData });
  }

  delay(ms: number, options?: TimerOptions) {
    return delay(ms, { ...options, scope: [this, options?.scope] });
  }

  replaceToken(token: Token) {
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

  #parts() {
    return { token: this.token, resources: this.resources, contextData: this.contextData };
  }

  static from<V extends object = object>(this: void, src: ToScope<V>): Scope<V> {
    return scopeFrom(src);
  }

  /** An empty scope that will never be closed. */
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

class StaticScope extends Scope {
  readonly resources = ScopedResources.empty;
  override get token(): Token {
    return STATIC_TOKEN;
  }
}

export const STATIC_SCOPE: Scope = new StaticScope();

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

export type ToScope<V extends object = object> = object extends V ? ToScopeBase<V> : ToScopeWithContext<V>;
