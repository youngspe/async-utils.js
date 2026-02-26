import { EmitOnce } from '../emitOnce.ts';
import { ImmediateUnwrapError } from '../errors.ts';
import {
  Immediate,
  type _Immediate,
  type ImmediateRejected,
  type ImmediateResolved,
} from '../immediate.ts';
import type { _evaluationKind, Awaitable, EvaluationKind, ImmediateInput } from '../types.ts';
import { isIterable, isPromiseLike, MaybeWeakRef } from '../util.ts';
import { allIterable, allObject, any, race } from './combine.ts';

const _emitter = Symbol('_emitter');
const _wrapped = Symbol('_wrapped');
const _wrappedError = Symbol('_wrappedError');

export class _ImmediateImpl<T, K extends EvaluationKind = EvaluationKind> implements _Immediate<T, K> {
  declare readonly [_evaluationKind]?: K;

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

      if (_inner instanceof Immediate) return _inner as this;

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
      const _innerError = innerError;

      innerError = undefined;

      if (_innerError instanceof Immediate) {
        if (_innerError.isRejected()) return _innerError as unknown as this;

        return _innerError.then(x => {
          throw x;
        }) as _Immediate<T> as this;
      }

      this.error = _innerError;

      if (isPromiseLike(_innerError)) {
        this[_wrappedError] = _innerError;

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

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => ImmediateInput<TResult1>) | null,
    onrejected?: ((reason: unknown) => ImmediateInput<TResult2>) | null,
  ): Immediate<TResult1 | TResult2> {
    type Ret = _Immediate<TResult1 | TResult2>;
    if (!onfulfilled && !onrejected) return this as Ret;

    try {
      if ('value' in this) {
        if (!onfulfilled) return this as Ret;
        return Immediate.resolve(onfulfilled(this.value)) as Ret;
      }

      const wrappedError = this[_wrappedError];

      if (wrappedError) {
        if (!onrejected) return this as Ret;
        return Immediate.resolve(wrappedError.then<TResult2, TResult2>(onrejected, onrejected));
      }

      if ('error' in this) {
        if (!onrejected) return this as Ret;
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

  finally(onfinally?: (() => _Immediate<void> | Awaitable<void>) | null): Immediate<T> {
    if (!onfinally) return this;

    const handler = () => {
      const out = onfinally();
      if (out instanceof Immediate && out.isResolved()) return this;
      if (isPromiseLike(out)) return out.then(() => this);
      return this;
    };

    return this.then(handler, handler);
  }

  isResolved(): this is ImmediateResolved<any> {
    return 'value' in this;
  }

  isRejected(): this is ImmediateRejected<any> {
    return 'error' in this;
  }

  isComplete(): this is ImmediateResolved<any> | ImmediateRejected<any> {
    return 'value' in this || 'error' in this;
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

  public static resolve<T, K extends EvaluationKind>(
    value?: _Immediate<T | undefined, K> | Awaitable<T | undefined>,
  ): Immediate<T | undefined, K> {
    if (value instanceof Immediate) return value as Immediate<T | undefined, K>;

    if (isPromiseLike(value)) {
      return new this(resolve => resolve(value)) as _Immediate<T | undefined, K> as Immediate<
        T | undefined,
        K
      >;
    }

    return createResolved(value) as Immediate<T | undefined, K>;
  }

  public static reject<K extends EvaluationKind>(value?: unknown): Immediate<never, K> {
    if (value instanceof Immediate) {
      if (value.isRejected<never>()) return value as Immediate<never, K>;
      if (value.isResolved()) return createRejected(value.value) as Immediate<never, K>;
    }

    if (isPromiseLike(value)) {
      return new this((_, reject) => reject(value)) as Immediate<never, K>;
    }

    return createRejected(value) as Immediate<never, K>;
  }

  public static all<T, K extends EvaluationKind>(
    values: Iterable<ImmediateInput<T, K>> | Record<string, ImmediateInput<T, K>>,
  ): Immediate<T[] | Record<string, T>, K> {
    if (isIterable(values)) {
      return allIterable(values);
    }

    return allObject(values);
  }

  public static any<T, K extends EvaluationKind>(values: Iterable<ImmediateInput<T, K>>) {
    return any(values);
  }

  public static race<T, K extends EvaluationKind>(values: Iterable<ImmediateInput<T, K>>) {
    return race(values);
  }

  public static try<T, Args extends readonly unknown[] = [], K extends EvaluationKind = EvaluationKind>(
    fn: (...args: Args) => ImmediateInput<T, K>,
    ...args: Args
  ): Immediate<T, K> {
    try {
      return Immediate.resolve(fn(...args));
    } catch (ex) {
      return Immediate.reject(ex);
    }
  }

  public static readonly NEVER = Object.freeze(Object.create(_ImmediateImpl.prototype)) as Immediate<never>;
}

export const createResolved = <T>(value: T): ImmediateResolved<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const out = Object.create(_ImmediateImpl.prototype);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  out.value = value;
  return out as ImmediateResolved<T>;
};

export const createRejected = <T = never>(error?: unknown): ImmediateRejected<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const out = Object.create(_ImmediateImpl.prototype);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  out.error = error;
  return out as ImmediateRejected<T>;
};
