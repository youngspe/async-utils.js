import type { Awaitable, Falsy } from '../types.ts';
import { Token, STATIC_TOKEN } from '../token.ts';
import { type CancellableOptions } from '../cancel.ts';
import { scopeFrom } from './from.ts';
import type { CancellableLike } from '../cancel.ts';
import { isPromiseLike } from '../utils.ts';
import { ScopedResources } from '../scopedResource.ts';
import { StandardScope } from '../scope.ts';

export interface CommonScopeOptions extends CancellableOptions {}

export interface ScopeRunOptions extends CommonScopeOptions {}

export interface ScopeContextBase {
  readonly scope: Scope;
  readonly token: Token;
  readonly resources: ScopedResources;
  readonly signal: AbortSignal;
}

export type ScopeContext<T extends object = object> = Omit<T, keyof ScopeContextBase> & ScopeContextBase;

export abstract class Scope {
  abstract get token(): Token;

  abstract get resources(): ScopedResources;

  get isClosed(): boolean {
    return this.token.isCancelled;
  }

  get signal(): AbortSignal {
    return this.token.signal;
  }

  throwIfClosed() {
    this.token.throwIfCancelled();
  }

  protected _onError(value: unknown): void {
    throw value;
  }

  use<T extends CancellableLike>(value: T): T {
    return this.token.use(value);
  }

  tryUse<T extends CancellableLike>(value: T): T | undefined {
    return this.token.tryUse(value);
  }

  readonly scope: Scope = this;

  resolveOrCancel<T>(promise: Awaitable<T>): Promise<T> {
    const { token } = this;

    const { error } = token;
    if (error) return Promise.reject(error);

    if (!isPromiseLike(promise)) return Promise.resolve(promise);

    return new Promise((resolve, reject) => {
      const sub = token.add(reject);

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

  #subScope(token: Token, options?: CommonScopeOptions) {
    return scopeFrom([this, token, options]);
  }

  /**
   *
   * @param block the function to run
   * @param options
   * @returns a promise that resolves to the result of `block`, or rejects if the scope is closed first.
   */
  async run<R>(block: (cx: ScopeContext) => Awaitable<R>, options?: ScopeRunOptions): Promise<R> {
    await using controller = this.use(Token.createController());
    const subScope = this.#subScope(controller.token, options);

    try {
      return await subScope.resolveOrCancel(block(new Scope.#Context(subScope)));
    } catch (error) {
      await controller.cancel(error);
      throw error;
    }
  }

  function<R, Args extends readonly unknown[]>(
    block: (cx: ScopeContext, ...args: Args) => Awaitable<R>,
    options?: ScopeRunOptions,
  ): (...args: Args) => Promise<R> {
    let _block: typeof block | Error = block;
    const controller = this.tryUse(Token.createController());
    if (!controller) return () => Promise.reject(this.token.error);
    const subScope = this.#subScope(controller.token, options);

    const sub = subScope.token.add(reason => {
      _block = reason;
    });

    return async (...args) => {
      sub?.dispose();
      if (_block instanceof Error) throw _block;
      try {
        const ret = await subScope.resolveOrCancel(_block(new Scope.#Context(subScope), ...args));
        await controller.cancel();
        return ret;
      } catch (error) {
        await controller.cancel(error);
        throw error;
      }
    };
  }

  withResources(block: (builder: ScopedResources.Builder) => ScopedResources.Builder | void): Scope {
    const builder = ScopedResources.builder(this.token).inherit(this.resources);
    block(builder);
    const resources = builder.finish();
    return new StandardScope({ ...this, resources });
  }

  static from(this: void, src: ToScope): Scope {
    return scopeFrom(src);
  }

  /** An empty scope that will never be closed. */
  static get static() {
    return STATIC_SCOPE;
  }

  static readonly #Context = class Context implements ScopeContext {
    readonly scope: Scope;
    get token() {
      return this.scope.token;
    }
    get signal() {
      return this.scope.signal;
    }
    get resources() {
      return this.scope.resources;
    }

    constructor(scope: Scope) {
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

export type ToScope =
  | Scope
  | Token
  | readonly ToScope[]
  | Set<ToScope>
  | AbortSignal
  | CancellableOptions
  | Falsy;
