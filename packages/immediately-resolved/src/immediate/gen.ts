import { type _Immediate, type AwaitedValueOf, Immediate, type ImmediateInput } from '../immediate.ts';
import type { ImmediateState } from '../state.ts';
import type { Awaitable } from '../types.ts';
import { isPromiseLike } from '../util.ts';

declare const _suspendSymbolState: unique symbol;

interface _SuspendSymbol<out S extends ImmediateState.Initial> {
  [_suspendSymbolState]?: S;
}
type SuspendSymbol<K extends ImmediateState.Initial = ImmediateState> = typeof suspendSymbol
  & _SuspendSymbol<K>;

export interface ImmediateGenerator<
  T,
  out S extends ImmediateState.Initial = ImmediateState,
> extends IterableIterator<SuspendImmediateGenerator<T> | SuspendSymbol<S>, T, typeof pollSymbol> {}

const resumeWith = Symbol('resumeWith');
const suspendSymbol = Symbol('suspend');
const pollSymbol = Symbol('poll');

interface SuspendImmediateGenerator<_T> {
  [resumeWith](wake: () => void): void;
}

type AwaitFunc = <
  A extends ImmediateInput<T, S>,
  T = AwaitedValueOf<A>,
  S extends ImmediateState.Initial = ImmediateState.For<A>,
>(
  value: A | ImmediateInput<T, S>,
) => ImmediateGenerator<T, S>;

const generatorToImmediate = <
  T extends _T,
  G extends ImmediateGenerator<Awaitable<T>, S>,
  S extends ImmediateState = G extends ImmediateGenerator<infer A, infer _K> ? _K | ImmediateState.For<A>
  : ImmediateState,
  _T = G extends Iterable<any, Awaitable<infer _T>, never> ? _T : unknown,
>(
  gen: G,
) =>
  new Immediate((resolve, reject) => {
    let _gen: ImmediateGenerator<Awaitable<T>, S> | undefined = gen;
    let running = false;
    let shouldWake = false;

    const wake = () => {
      shouldWake = true;
      if (!_gen || running) return;
      running = true;

      while (shouldWake) {
        shouldWake = false;

        try {
          const result = _gen.next(pollSymbol);

          if (result.done) {
            _gen = undefined;
            return resolve(result.value);
          }

          if (result.value !== suspendSymbol) {
            result.value[resumeWith](wake);
          }
        } catch (e) {
          _gen = undefined;
          return reject(e);
        }
      }

      running = false;
    };

    wake();
  }) as Immediate<T, S>;

export const immediate = <
  const T extends _T,
  G extends ImmediateGenerator<Awaitable<T>, S>,
  S extends ImmediateState.Initial = G extends ImmediateGenerator<infer A, infer _S> ?
    _S | ImmediateState.For<A>
  : ImmediateState,
  _T = G extends Iterable<any, Awaitable<infer _T>, never> ? _T : unknown,
>(
  body: (this: { await: AwaitFunc }, await: AwaitFunc) => G,
): Immediate<T, S | ImmediateState.Rejected> => immediate.bound({ await: awaitFunc }, body);

const resolveNow = <T>(value: T): IterableIterator<never, T, unknown> => ({
  next() {
    return { done: true, value };
  },
  [Symbol.iterator]() {
    return this;
  },
});

const rejectNow = (error: unknown): IterableIterator<never, never, unknown> => ({
  next() {
    throw error;
  },
  [Symbol.iterator]() {
    return this;
  },
});

immediate.bound = <
  This,
  T extends _T,
  G extends ImmediateGenerator<Awaitable<T>, S>,
  S extends ImmediateState.Initial = G extends ImmediateGenerator<infer A, infer _S> ?
    _S | ImmediateState.For<A>
  : ImmediateState,
  _T = G extends Iterable<any, Awaitable<infer _T>, never> ? _T : unknown,
>(
  thisArg: This,
  body: (this: This, await: AwaitFunc) => G,
): Immediate<_T, S | ImmediateState.Rejected> => generatorToImmediate(body.call(thisArg, awaitFunc));

const awaitFunc = <
  A extends ImmediateInput<T, K>,
  T = AwaitedValueOf<A>,
  K extends ImmediateState.Initial = ImmediateState.For<A>,
>(
  value: A & ImmediateInput<T, K>,
): ImmediateGenerator<T, K> => {
  if (!isPromiseLike(value)) return resolveNow(value);

  if (Immediate.isImmediate(value)) {
    if (value.isResolved()) return resolveNow(value.value);
    if (value.isRejected()) return rejectNow(value.error);

    if ('error' in value && !isPromiseLike(value.error)) return rejectNow(value.error);
  }

  let result: IteratorReturnResult<T> | { done?: never; error: unknown } | undefined;
  let promise: PromiseLike<T> | null = value;

  return {
    next(poll?) {
      if (result?.done) return result;
      if (result) throw result.error;

      if (!poll && promise) {
        let _promise: PromiseLike<T> | null = promise;
        promise = null;
        return {
          done: false,
          value: {
            [resumeWith]: wake => {
              _promise?.then(
                value => {
                  result = { done: true, value };
                  wake();
                },
                error => {
                  result = { error };
                  wake();
                },
              );
              _promise = null;
            },
          },
        };
      }

      return { done: false, value: suspendSymbol };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
};
