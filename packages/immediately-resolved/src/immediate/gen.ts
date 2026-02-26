import { type _Immediate, Immediate } from '../immediate.ts';
import type {
  _evaluationKind,
  Awaitable,
  EvaluationKind,
  EvaluationKindOf,
  ImmediateInput,
} from '../types.ts';
import { isPromiseLike } from '../util.ts';

interface _SuspendSymbol<out K extends EvaluationKind> {
  [_evaluationKind]?: K;
}
type SuspendSymbol<K extends EvaluationKind = EvaluationKind> = typeof suspendSymbol & _SuspendSymbol<K>;

export interface ImmediateGenerator<
  T,
  out K extends EvaluationKind = EvaluationKind,
> extends IterableIterator<SuspendImmediateGenerator<T> | SuspendSymbol<K>, T, typeof pollSymbol> {}

const resumeWith = Symbol('resumeWith');
const suspendSymbol = Symbol('suspend');
const pollSymbol = Symbol('poll');

interface SuspendImmediateGenerator<_T> {
  [resumeWith](wake: () => void): void;
}

type AwaitFunc = <
  A extends ImmediateInput<T, K>,
  T = A extends _Immediate<infer _T> | Awaitable<infer _T> ? _T : unknown,
  K extends EvaluationKind = EvaluationKindOf<A>,
>(
  x: A,
) => ImmediateGenerator<T, K>;

const generatorToImmediate = <
  T extends _T,
  G extends ImmediateGenerator<Awaitable<T>, K>,
  K extends EvaluationKind = G extends ImmediateGenerator<infer A, infer _K> ? _K | EvaluationKindOf<A>
  : EvaluationKind,
  _T = G extends Iterable<any, Awaitable<infer _T>, never> ? _T : unknown,
>(
  gen: G,
) =>
  new Immediate((resolve, reject) => {
    let _gen: ImmediateGenerator<Awaitable<T>, K> | undefined = gen;
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
  }) as Immediate<T, K>;

export const immediate = <
  T extends _T,
  G extends ImmediateGenerator<Awaitable<T>, K>,
  K extends EvaluationKind = G extends ImmediateGenerator<infer A, infer _K> ? _K | EvaluationKindOf<A>
  : EvaluationKind,
  _T = G extends Iterable<any, Awaitable<infer _T>, never> ? _T : unknown,
>(
  body: (this: { await: AwaitFunc }, await: AwaitFunc) => G,
): Immediate<T, K> => immediate.bound({ await: awaitFunc }, body);

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
  G extends ImmediateGenerator<Awaitable<T>, K>,
  K extends EvaluationKind = G extends ImmediateGenerator<infer A, infer _K> ? _K | EvaluationKindOf<A>
  : EvaluationKind,
  _T = G extends Iterable<any, Awaitable<infer _T>, never> ? _T : unknown,
>(
  thisArg: This,
  body: (this: This, await: AwaitFunc) => G,
): Immediate<_T, K> => generatorToImmediate(body.call(thisArg, awaitFunc));

const awaitFunc = <T, A extends ImmediateInput<T, K>, K extends EvaluationKind = EvaluationKindOf<A>>(
  value: A & ImmediateInput<T, K>,
): ImmediateGenerator<T, K> => {
  if (!isPromiseLike(value)) return resolveNow(value);

  if (value instanceof Immediate) {
    if ('value' in value) return resolveNow(value.value);
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
