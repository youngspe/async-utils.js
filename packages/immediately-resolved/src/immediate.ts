import { _ImmediateImpl } from './immediate/impl.ts';
import {
  type _evaluationKind,
  type Awaitable,
  type AwaitedValue,
  type EvaluationKind,
  type EvaluationKindOf,
  type ImmediateInput,
  type AsAwaitable,
  type ItemOf,
  type MustExtend,
  type EvaluationKindOfRace,
} from './types.ts';

export interface _Immediate<out T, out K extends EvaluationKind = EvaluationKind> extends PromiseLike<T> {
  readonly [_evaluationKind]?: K;
  value?: T;
  error?: unknown;

  then<A1 = Awaitable<T>, A2 = Awaitable<never>>(
    onfulfilled?: ((value: T) => AsAwaitable<A1>) | null,
    onrejected?: ((reason: unknown) => AsAwaitable<A2>) | null,
  ): Immediate<AwaitedValue<A1 | A2>, K | EvaluationKindOf<A1 | A2>>;
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => Awaitable<TResult1>) | null,
    onrejected?: ((reason: unknown) => Awaitable<TResult2>) | null,
  ): Immediate<TResult1 | TResult2>;

  catch<A = Awaitable<never>>(
    onrejected?: ((reason: unknown) => AsAwaitable<A>) | null,
  ): Immediate<AwaitedValue<A>, K | EvaluationKindOf<A>>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Immediate<TResult>;

  finally<A extends Awaitable<void>>(
    onfinally?: (() => A & Awaitable<void>) | null,
  ): Immediate<T, K | EvaluationKindOf<A>>;
  finally(onfinally?: () => Awaitable<void>): Immediate<T>;

  isResolved<U = T>(this: _Immediate<U, K>): this is ImmediateResolved<U>;
  isResolved(): this is ImmediateResolved<unknown>;

  isRejected<U extends V, V = T>(this: _Immediate<V, K>): this is ImmediateRejected<U>;
  isRejected<U>(): this is ImmediateRejected<U>;

  isComplete<U extends V, V = T>(
    this: _Immediate<V, K>,
  ): this is ImmediateResolved<V> | ImmediateRejected<U>;

  isComplete(): this is ImmediateResolved<unknown> | ImmediateRejected<unknown>;
  unwrap(): T;
}

type ImmediateInputOfArray<
  T extends readonly unknown[],
  K extends EvaluationKind = EvaluationKind,
> = MustExtend<readonly unknown[], { [Idx in keyof T]: ImmediateInput<T[Idx], K> }>;

type AwaitedValueOfArray<A extends readonly unknown[]> = MustExtend<
  unknown[],
  { -readonly [Idx in keyof A]: AwaitedValue<A[Idx]> }
>;

interface MappingObject {
  readonly [k: string]: unknown;
}

type ImmediateInputOfObject<T extends MappingObject, K extends EvaluationKind> = MustExtend<
  MappingObject,
  { [Idx in keyof T as Idx & string]: ImmediateInput<T[Idx], K> }
>;

type AwaitedValueOfObject<A extends MappingObject> = MustExtend<
  MappingObject,
  { -readonly [Idx in keyof A as Idx & string]: AwaitedValue<A[Idx]> }
>;

type PropsOf<T> = T extends { [_ in keyof T]: infer V } ? V : T[keyof T];

export interface ImmediateConstructor {
  new <T>(
    executor: (resolve: (value: Awaitable<T>) => void, reject: (error?: unknown) => void) => void,
  ): Immediate<T>;

  prototype: Immediate<unknown>;

  resolve(): ImmediateResolved<void>;
  resolve<A extends Immediate<any>>(value: A): A;
  resolve<T, A extends T | ImmediateInput<T, K>, K extends EvaluationKind = EvaluationKindOf<A>>(
    value: A | ImmediateInput<T>,
  ): Immediate<T, K>;
  resolve<T, K extends EvaluationKind = EvaluationKind>(value: ImmediateInput<T, K>): Immediate<T, K>;

  reject<T = never>(): ImmediateRejected<T>;
  reject<A extends ImmediateRejected<T>, T = any>(value: A): A;

  reject<U, A extends ImmediateInput<U, K>, T = never, K extends EvaluationKind = EvaluationKindOf<A>>(
    value: A,
  ): EvaluationKind.Async extends K ? _Immediate<T, K> : ImmediateRejected<T>;
  reject<T, K extends EvaluationKind = EvaluationKind>(value: ImmediateInput<T, K>): Immediate<T, K>;

  all<
    const A extends ImmediateInputOfArray<T, K>,
    T extends readonly unknown[] = AwaitedValueOfArray<A>,
    K extends EvaluationKind = EvaluationKindOf<A[number]>,
  >(
    values: A,
  ): Immediate<T, K>;
  all<
    I extends Iterable<A>,
    A extends ImmediateInput<T, K> = ItemOf<I>,
    T = AwaitedValue<A>,
    K extends EvaluationKind = EvaluationKindOf<A>,
  >(
    values: I,
  ): Immediate<T[], K>;
  all<
    A extends ImmediateInputOfObject<T, K>,
    T extends MappingObject = AwaitedValueOfObject<A>,
    K extends EvaluationKind = EvaluationKindOf<PropsOf<A>>,
  >(
    values: A,
  ): Immediate<T, K>;

  any<
    const A extends readonly ImmediateInput<T, K>[],
    T = AwaitedValue<A[number]>,
    K extends EvaluationKind = EvaluationKindOf<A[number]>,
  >(
    values: A,
  ): Immediate<T, K>;
  any<A extends ImmediateInput<T, K>, T = AwaitedValue<A>, K extends EvaluationKind = EvaluationKindOf<A>>(
    values: Iterable<A>,
  ): Immediate<T, K>;
  any<T, K extends EvaluationKind = EvaluationKind>(
    values: Iterable<ImmediateInput<T, K>>,
  ): Immediate<T, K>;

  race<
    const A extends ImmediateInput<T, K>[],
    T = AwaitedValue<A[number]>,
    K extends EvaluationKind = EvaluationKindOf<A[number]>,
  >(
    values: A,
  ): Immediate<T, EvaluationKindOfRace<A>>;
  race<A extends ImmediateInput<T, K>, T = AwaitedValue<A>, K extends EvaluationKind = EvaluationKindOf<A>>(
    values: Iterable<A>,
  ): Immediate<T, K>;
  race<T, K extends EvaluationKind = EvaluationKind>(
    values: Iterable<ImmediateInput<T, K>>,
  ): Immediate<T, K>;

  try<
    A extends ImmediateInput<T, K>,
    T = AwaitedValue<A>,
    Args extends readonly unknown[] = [],
    K extends EvaluationKind = EvaluationKind,
  >(
    fn: (...args: Args) => ImmediateInput<T, K>,
    ...args: Args
  ): Immediate<T, K>;
  try<T, Args extends readonly unknown[] = [], K extends EvaluationKind = EvaluationKind>(
    fn: (...args: Args) => ImmediateInput<T, K>,
    ...args: Args
  ): Immediate<T, K>;

  readonly NEVER: Immediate<never>;
}

interface ImmediateSync<T> extends _Immediate<T, EvaluationKind.Sync> {}

export interface ImmediateResolved<T> extends ImmediateSync<T> {
  value: T;
  error?: never;
}
export interface ImmediateRejected<T> extends ImmediateSync<T> {
  value?: never;
  error: unknown;
}

export type Immediate<T, K extends EvaluationKind = EvaluationKind> =
  EvaluationKind.Async extends K ? _Immediate<T, K> : ImmediateResolved<T> | ImmediateRejected<T>;

export const Immediate = _ImmediateImpl as unknown as ImmediateConstructor;

export { immediate, type ImmediateGenerator } from './immediate/gen.ts';
