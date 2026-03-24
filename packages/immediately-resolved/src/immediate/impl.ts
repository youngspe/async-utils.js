import { EmitOnce } from '../emitOnce.ts';
import { ImmediateUnwrapError } from '../errors.ts';
import {
  type _value,
  Immediate,
  type _Immediate,
  type ValueOf,
  type ImmediateInput,
} from '../immediate.ts';
import type { ImmediateState } from '../state.ts';
import type { Awaitable, SoftIntersect } from '../types.ts';
import { isIterable, isPromiseLike, MaybeWeakRef } from '../util.ts';
import { allIterable, allObject, any, race } from './combine.ts';

const _emitter = Symbol('_emitter');
const _wrapped = Symbol('_wrapped');
const _wrappedError = Symbol('_wrappedErrpr');

const _marker = Symbol.for('immediately-resolved.immediate-marker');

export class _ImmediateImpl<T> implements _Immediate<T, ImmediateState.Initial> {
  static {
    Object.defineProperty(this.prototype, _marker, {
      value: undefined,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
  declare [_value]?: { value: T };
  declare value?: T;
  declare error?: unknown;

  private [_emitter]: MaybeWeakRef<EmitOnce<T>> | undefined;
  private [_wrapped]: PromiseLike<T> | undefined;
  private [_wrappedError]: PromiseLike<unknown> | undefined;

  constructor(
    executor: (resolve: (value: Awaitable<T>) => void, reject: (error?: unknown) => void) => void,
  ) {
    let resolveCalled = false;
    let rejectCalled = false;
    let inner: _Immediate<T> | Awaitable<T> | undefined;
    let innerError: unknown;
    let resolve: ((value: Awaitable<T>) => void) | undefined;
    let reject: ((error?: unknown) => void) | undefined;

    try {
      executor(
        value => {
          if (resolveCalled || rejectCalled) return;
          resolveCalled = true;

          if (resolve) {
            const _resolve = resolve;
            resolve = reject = undefined;

            _resolve(value);

            return;
          }

          inner = value;
        },
        e => {
          if (resolveCalled || rejectCalled) return;
          rejectCalled = true;

          if (reject) {
            const _reject = reject;
            resolve = reject = undefined;
            _reject(e);

            return;
          }

          innerError = e;
        },
      );
    } catch (e) {
      innerError = e;
    }

    if (resolveCalled) {
      const _inner = inner;

      inner = undefined;

      if (Immediate.isImmediate(_inner)) return _inner as unknown as this;

      if (isPromiseLike(_inner)) {
        this[_wrapped] = _inner;

        _inner.then(
          value => {
            this.value = value;
            this[_wrapped] = undefined;
          },
          error => {
            this.error = error;
            this[_wrapped] = undefined;
          },
        );
      } else {
        this.value = _inner!;
      }
    } else if (rejectCalled) {
      const _innerError = (this[_wrappedError] = Immediate.resolve(innerError));
      innerError = undefined;
      this[_wrappedError] = _innerError;

      if (_innerError.isRejecting()) return _innerError as Immediate<T> as this;

      if (_innerError.isResolved()) {
        this.error = _innerError.value;
        return;
      }

      _innerError.then(
        e => {
          this.error = e;
        },
        e => {
          this.error = e;
        },
      );

      this.error = _innerError;

      if (isPromiseLike(_innerError)) {
        this[_wrappedError] = Immediate.resolve(_innerError);

        _innerError.then(
          value => {
            this.error = value;
            this[_wrappedError] = undefined;
          },
          error => {
            this.error = error;
            this[_wrappedError] = undefined;
          },
        );
      }
    } else {
      const emitter = ({ resolve, reject } = new EmitOnce<T>());
      emitter.addHandler(
        value => {
          this[_emitter] = undefined;
          this.value = value;
        },
        error => {
          this[_emitter] = undefined;
          this.error = error;
        },
      );
      this[_emitter] = new MaybeWeakRef(emitter);
    }
  }

  then<TResult1, TResult2>(
    onfulfilled?: ((value: ValueOf<this>) => ImmediateInput<TResult1>) | null,
    onrejected?: ((reason: unknown) => ImmediateInput<TResult2>) | null,
  ): Immediate<TResult1 | TResult2> {
    type Ret = _Immediate<TResult1 | TResult2>;
    if (!onfulfilled && !onrejected) return this as _Immediate<T> as Ret;

    try {
      if ('value' in this) {
        if (!onfulfilled) return this as _Immediate<any, any>;
        return Immediate.resolve(onfulfilled(this.value)) as Ret;
      }

      const wrappedError = this[_wrappedError];

      if (wrappedError) {
        if (!onrejected) return this as _Immediate<any, any>;
        return Immediate.resolve(wrappedError.then<TResult2, TResult2>(onrejected, onrejected));
      }

      if ('error' in this) {
        if (!onrejected) return this as _Immediate<any, any>;
        return Immediate.resolve(onrejected(this.error)) as Ret;
      }

      const wrapped = this[_wrapped];

      if (wrapped) {
        return Immediate.resolve(wrapped.then<TResult1, TResult2>(onfulfilled, onrejected));
      }

      return (this[_emitter]?.deref()?.then(onfulfilled, onrejected) ?? this) as Ret;
    } catch (error) {
      return Immediate.reject(error);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => _Immediate<TResult> | Awaitable<TResult>) | null,
  ): Immediate<TResult> {
    return this.then(null, onrejected);
  }

  finally(onfinally?: (() => ImmediateInput<void>) | null): Immediate<T>;
  finally(onfinally?: (() => unknown) | null): Immediate<T>;
  finally(onfinally?: (() => ImmediateInput<void>) | null): Immediate<T> {
    if (!onfinally) return this;

    const handler = () => {
      const out = onfinally();
      if ((out instanceof Immediate && out.isResolved()) || !isPromiseLike(out)) return this;
      return out.then(() => this);
    };

    return this.then(handler, handler);
  }

  isResolved<T1 = T>(this: _Immediate<T1>): this is Immediate<T1, ImmediateState.Resolved> {
    return !('error' in this) && 'value' in this;
  }

  isRejecting<T1, S1 extends ImmediateState.Initial>(
    this: this & _Immediate<T1, S1>,
  ): this is Immediate.Rejecting<T1, S1> {
    return 'error' in this || !!this[_wrappedError];
  }

  isRejected<T1 = T>(this: _Immediate<T1>): this is Immediate<T1, ImmediateState.Rejected> {
    return 'error' in this;
  }

  isSettled<T1 = T>(this: _Immediate<T1>): this is Immediate<T1, ImmediateState.Settled> {
    return 'value' in this;
  }

  unwrap(): T {
    if ('value' in this) return this.value;

    if ('error' in this) {
      if (isPromiseLike(this.error)) {
        throw new ImmediateUnwrapError(this.error, 'Unwrapped Immediate with a pending error');
      }

      throw this.error;
    }

    throw new ImmediateUnwrapError(
      this[_wrapped] ?? this[_wrappedError] ?? this,
      'Unexpected promise-like in synchronous operation',
    );
  }

  public static resolve<T, S extends ImmediateState.Initial>(
    value?: ImmediateInput<T, S>,
  ): Immediate<T | undefined, S> {
    if (value instanceof Immediate) return value as Immediate<T | undefined, S>;

    if (isPromiseLike(value)) {
      return new this(resolve => resolve(value)) as _Immediate<T | undefined, any> as Immediate<
        T | undefined,
        S
      >;
    }

    return createResolved(value) as Immediate<T | undefined, any> as Immediate<T | undefined, S>;
  }

  public static reject(value?: unknown): Immediate<never> {
    if (Immediate.isImmediate(value)) {
      if (value.isRejecting()) return value;
      if (value.isResolved()) return createRejected(value.value) as Immediate<never>;
    }

    if (isPromiseLike(value)) {
      return new this((_, reject) => reject(value)) as Immediate<any> as Immediate<never>;
    }

    return createRejected(value) as Immediate<never>;
  }

  public static all<T>(
    values: Iterable<ImmediateInput<T>> | Record<string, ImmediateInput<T>>,
  ): Immediate<T[] | Record<string, T>> {
    if (isIterable(values)) {
      return allIterable(values);
    }

    return allObject(values);
  }

  public static any<T>(values: Iterable<ImmediateInput<T>>) {
    return any(values);
  }

  public static race<T>(values: Iterable<ImmediateInput<T>>) {
    return race(values);
  }

  public static try<T, Args extends readonly unknown[] = []>(
    fn: (...args: Args) => ImmediateInput<T>,
    ...args: Args
  ): Immediate<T> {
    try {
      return Immediate.resolve(fn(...args));
    } catch (ex) {
      return Immediate.reject(ex);
    }
  }

  public static readonly NEVER = Object.freeze(Object.create(_ImmediateImpl.prototype)) as Immediate<never>;

  isImmediate<A extends ImmediateInput<T>, T>(value: A): value is SoftIntersect<A, Immediate<T>> {
    return value !== null && typeof value === 'object' && _marker in value;
  }
}

export const createResolved = <T>(value: T): Immediate.Resolved<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const out = Object.create(_ImmediateImpl.prototype);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  out.value = value;
  return out as Immediate<T, ImmediateState.Resolved>;
};

export const createRejected = <T = never>(error?: unknown): Immediate.Rejected<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const out = Object.create(_ImmediateImpl.prototype);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  out.error = error;
  return out as Immediate<T, ImmediateState.Rejected>;
};
