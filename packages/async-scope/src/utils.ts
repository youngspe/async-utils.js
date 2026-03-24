import { ControlFlowLike, ControlFlow } from './controlFlow.ts';
import { OrNever } from './types.ts';
import type { Awaitable, IfExactOptionalPropertiesEnabled } from './types.ts';

type ExtractIterable<I> = I extends Iterable<infer X, infer Y, infer Z> ? Iterable<X, Y, Z> : never;

type AsIterable<I> =
  Iterable<unknown, unknown, never> extends I ? ExtractIterable<I>
  : [I] extends [Iterable<unknown, unknown, never>] ? ExtractIterable<I>
  : Iterable<never, never, any>;

export function isIterable<T>(value: T | AsIterable<T> | null | undefined): value is AsIterable<T>;
export function isIterable(value: any) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return typeof value?.[Symbol.iterator] === 'function';
}

export function isPromiseLike<T>(value: Awaitable<T> | null | undefined): value is PromiseLike<T>;
export function isPromiseLike(value: any) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return typeof value?.then === 'function';
}

type ExtractArray<I> =
  I extends Array<infer X> ? X[]
  : I extends ReadonlyArray<infer X> ? readonly X[]
  : never;

type AsArray<I> =
  never[] extends I ? ExtractArray<I>
  : [I] extends [readonly any[]] ? ExtractArray<I>
  : unknown[];

export const isArray = Array.isArray.bind(Array) as <I>(
  value: I | AsArray<I> | null | undefined,
) => value is AsArray<I>;

export async function tryReducePromises<
  T,
  Cf extends ControlFlowLike<Awaitable<B>, Awaitable<C>>,
  B = Awaited<ControlFlow.BreakValue<Cf>>,
  C = Awaited<ControlFlow.ContinueValue<Cf>>,
>(
  promises: Iterable<Awaitable<T>>,
  combine: (
    acc: C,
    item: PromiseSettledResult<T>,
    index: number,
  ) => Awaitable<Cf | ControlFlowLike<Awaitable<B>, Awaitable<C>>>,
  init: Awaitable<C>,
): Promise<ControlFlow<B, C>> {
  const resultPromises = Array.from(
    promises,
    (promise): Awaitable<PromiseSettledResult<T>> =>
      isPromiseLike(promise) ?
        promise.then(
          value => ({ status: 'fulfilled', value }),
          (reason: unknown) => ({ status: 'rejected', reason }),
        )
      : { status: 'fulfilled', value: promise },
  );

  let i = 0;

  let acc: C = await init;

  for (const resultPromise of resultPromises) {
    const index = i++;
    const result = await resultPromise;

    const ctrl = ControlFlow.from(await combine(acc, result, index));

    if ('break' in ctrl) return { break: await ctrl.break };
    acc = await ctrl.continue;
  }

  return { continue: acc };
}

export async function reducePromises<T, A>(
  promises: Iterable<Awaitable<T>>,
  combine: (acc: A, item: PromiseSettledResult<T>, index: number) => Awaitable<A>,
  init: Awaitable<A>,
): Promise<A> {
  return (await tryReducePromises(promises, (...args) => ({ continue: combine(...args) }), init)).continue;
}

interface _ResultBase<out T, out E> {
  readonly ok?: T;
  readonly err?: E;
}

type ResultBase<T, E> = IfExactOptionalPropertiesEnabled<_ResultBase<T, E>, {}>;

namespace Result {
  export interface OkObject<out T> extends ResultBase<T, never> {
    readonly ok: T;
  }
  export interface ErrObject<out E> extends ResultBase<never, E> {
    readonly err: E;
  }

  export type Ok<T> = OkObject<T> & OrNever<T>;
  export type Err<E = unknown> = ErrObject<E> & OrNever<E>;
}

type Result<T, E = unknown> = Result.Ok<T> | Result.Err<E>;

type AwaitableArray<T extends readonly any[]> = { readonly [K in keyof T]: Awaitable<T[K]> };

/**
 * Like `Promise.allSettled()`, this waits until all promises have settled. Like `Promise.all()`, this rejects if any promise rejects.
 * @param promises
 * @returns
 */
export async function joinPromisesAggregatingErrors<T extends any[]>(
  promises: AwaitableArray<T>,
): Promise<T>;
export async function joinPromisesAggregatingErrors<T>(promises: Iterable<Awaitable<T>>): Promise<T[]>;
export async function joinPromisesAggregatingErrors<T>(promises: Iterable<Awaitable<T>>): Promise<T[]> {
  const ctrl = await reducePromises(
    promises,
    (acc: Result<T[], Set<unknown>>, item) => {
      if (item.status === 'fulfilled') {
        if (acc.ok) {
          acc.ok.push(item.value);
        }

        return acc;
      }

      if (acc.ok) {
        acc = { err: new Set() };
      }

      acc.err.add(item.reason);
      return acc;
    },
    { ok: [] },
  );

  if (ctrl.ok) return ctrl.ok;

  if (ctrl.err.size > 1) throw new AggregateError(ctrl.err);

  const [err] = ctrl.err;

  throw err;
}
