import { ScopeBase } from '@youngspe/async-scope-common';
import { isPromiseLike } from '@youngspe/common-async-utils';

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
import { CancellationError, unwrapCancellationError } from '../error.ts';

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

export type ScopeContext<T extends object = object> = BetterOmit<T, keyof ScopeContextBase>
  & ScopeContextBase<T>;

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
  getContext(options?: CancellableOptions & { values?: undefined }): ScopeContext<V>;
  getContext<V2 extends object>(
    options: CancellableOptions & { values: V2 },
  ): ScopeContext<UpdateObject<V, V2>>;
  getContext<V2 extends object = V>(
    options?: CancellableOptions & { values?: V2 | undefined },
  ): ScopeContext<UpdateObject<V, Partial<V2>>>;
  getContext<V2 extends object>(options?: CancellableOptions & { values?: Partial<V2> | undefined }) {
    this.throwIfClosed();

    let scope: Scope<object> = this;
    if (options?.scope || options?.token || options?.signal) {
      scope = Scope.from([scope, options]);
      scope.throwIfClosed();
    }
    if (options?.values) {
      scope = scope.withContextValues(options.values);
    }
    const cx = new Scope.#Context(scope);
    return scope.contextData.updateContext(cx);
  }

  async #run<R, V2 extends object = V, R2 = never>(
    block: (cx: ScopeContext<V2>) => Awaitable<R>,
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
        block(subScope.getContext()),
        onCancel ?? Promise.reject.bind(Promise),
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
    block: (cx: ScopeContext<V2>) => Awaitable<R>,
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
    block: (cx: ScopeContext<V2>) => Awaitable<R>,
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
    block: (cx: ScopeContext<V2>) => Awaitable<R>,
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
    block: (cx: ScopeContext<V2>) => Awaitable<R>,
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
  ): Scope<V | V2 | SetProps<V, V2>> {
    if (!data || data === ContextData.empty) return this;

    const builder = this.contextData.builder();

    if (typeof data === 'function') {
      data(builder);
    } else {
      builder.merge(data);
    }

    return new StandardScope<V | V2>({ ...this.#parts(), contextData: builder.finish() });
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
