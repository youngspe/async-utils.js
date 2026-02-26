import { Immediate } from './immediate.ts';
import type { Awaitable } from './types.ts';
import { isPromiseLike } from './util.ts';

interface EmitOnceHandler<in T> {
  onResolve?: (<U>(value: T) => Awaitable<U>) | null | undefined;
  onReject?: (<U>(error: unknown) => Awaitable<U>) | null | undefined;
  resolve?: (<U>(value: Awaitable<U>) => void) | null | undefined;
  reject?: (error?: unknown) => void;
}

export class EmitOnce<T> {
  private _state = 'init';
  private _handlers: EmitOnceHandler<T>[] | null = [];

  constructor() {
    let _this: this | null = this;

    this.resolve = (value: Awaitable<T>) => {
      const _this1 = _this;
      if (!_this1) return;
      _this = null;

      const handlers = _this1._handlers;
      if (_this1._state !== 'init' || !handlers) return;
      _this1._state = 'resolving';
      _this1.resolve = _this1.reject = () => {};

      if (isPromiseLike(value)) {
        for (const handler of handlers) {
          handler.onReject = null;
        }

        value.then(_this1._resolve.bind(_this1, handlers), _this1._reject.bind(_this1, handlers));
        return;
      }

      _this1._resolve(handlers, value);
    };

    this.reject = (error?: unknown) => {
      const _this1 = _this;
      if (!_this1) return;
      _this = null;

      const handlers = _this1._handlers;
      if (_this1._state !== 'init' || !handlers) return;
      _this1._state = 'rejecting';
      _this1.resolve = _this1.reject = () => {};

      if (isPromiseLike(error)) {
        for (const handler of handlers) {
          handler.onResolve = null;

          if (!handler.onReject) {
            handler.resolve = null;
          }
        }

        error.then(_this1._reject.bind(_this1, handlers), _this1._reject.bind(_this1, handlers));
        return;
      }

      _this1._reject(handlers, error);
    };
  }

  addHandler(onfulfilled?: ((value: T) => void) | null, onrejected?: ((reason: unknown) => void) | null) {
    const handlers = this._handlers;
    if (handlers === null || (!onfulfilled && (!onrejected || this._state === 'rejecting'))) {
      return null;
    }

    handlers.push({
      onResolve: this._state === 'rejecting' ? null : (onfulfilled as <U>(value: T) => Awaitable<U>),
      onReject: onrejected as <U>(value: unknown) => Awaitable<U>,
    });
  }

  then<U = T, U2 = never>(
    onfulfilled?: ((value: T) => Awaitable<U>) | null,
    onrejected?: ((reason: unknown) => Awaitable<U2>) | null,
  ): Immediate<U | U2> | null {
    const handlers = this._handlers;
    if (handlers === null || (!onfulfilled && (!onrejected || this._state === 'rejecting'))) {
      return null;
    }

    return new Immediate((resolve, reject) => {
      handlers.push({
        onResolve: this._state === 'rejecting' ? null : (onfulfilled as <U>(value: T) => Awaitable<U>),
        onReject: onrejected as <U>(value: unknown) => Awaitable<U>,
        resolve: resolve as <U>(value: Awaitable<U>) => void,
        reject,
      });
    });
  }

  private _resolve(handlers: readonly EmitOnceHandler<T>[], value: T) {
    this._handlers = null;

    for (const { onResolve, onReject, resolve, reject } of handlers) {
      if (!onResolve) {
        resolve?.(value);

        continue;
      }

      try {
        const out = onResolve(value);

        resolve?.(out);
      } catch (e) {
        if (onReject) {
          try {
            const out = onReject(e);

            resolve?.(out);
          } catch (e2) {
            reject?.(e2);
          }
        } else {
          reject?.(e);
        }
      }
    }
  }

  private _reject(handlers: readonly EmitOnceHandler<never>[], error?: unknown) {
    this._handlers = null;
    for (const { onReject, resolve, reject } of handlers) {
      if (!onReject) {
        reject?.(error);

        continue;
      }

      try {
        const out = onReject(error);

        resolve?.(out);
      } catch (e) {
        reject?.(e);
      }
    }
  }

  public resolve;
  public reject;
}
