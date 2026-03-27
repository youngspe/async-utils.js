import type { Awaitable, Falsy } from './types.ts';
import { Token, STATIC_TOKEN } from './token.js';
import { scopeFrom } from './scope/from.ts';
import type { CancellableLike } from './cancel.ts';
import { isPromiseLike } from './utils.ts';

export abstract class Scope {
  abstract get token(): Token;

  get isClosed(): boolean {
    return this.token.isCancelled;
  }

  get signal(): AbortSignal {
    return this.token.signal;
  }

  throwIfClosed() {
    this.token.throwIfCancelled();
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
      token.add(reject);

      promise.then(
        x => {
          token.remove(reject);
          resolve(x);
        },
        e => {
          token.remove(reject);
          reject(e);
        },
      );
    });
  }

  /**
   *
   * @param block the function to run
   * @param args the arguments to pass to the function
   * @returns a promise that resolves to the result of `block`, or rejects if the scope is closed first.
   */
  async run<R, Args extends any[] = []>(
    block: (scope: Scope, ...args: Args) => Awaitable<R>,
    ...args: Args
  ): Promise<R> {
    this.throwIfClosed();
    const { token, controller } = Token.withController();
    const childScope = scopeFrom([this, token]);

    try {
      const ret = await this.resolveOrCancel(block(childScope, ...args));
      await controller.cancel();
      return ret;
    } catch (error) {
      await controller.cancel(error);
      throw error;
    }
  }

  static from(this: void, src: ToScope): Scope {
    return scopeFrom(src);
  }

  /** An empty scope that will never be closed. */
  static get static() {
    return STATIC_SCOPE;
  }
}

class StaticScope extends Scope {
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
  | { scope?: ToScope | undefined; signal?: AbortSignal | undefined }
  | Falsy;
