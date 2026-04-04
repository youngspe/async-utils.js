import { _ImmediateImpl } from './immediate/impl.ts';
import type { HasState, ImmediateState, StateOfAll, StateOfRace, ImmediateStatesOfArray } from './state.ts';
import type { SoftIntersect, Awaitable, EnforceSubtype, ItemOf, AssumeSubtype } from './types.ts';

export type ValueOf<I extends _ImmediateBase<any, any>> = NonNullable<I[typeof _value]>['value'];

export type AwaitedValueOf<T> =
  T extends _Immediate<any, ImmediateState.Initial> ? ValueOf<T>
  : T extends Promise<infer _T> | Awaitable<infer _T> ? _T
  : never;

export declare const _value: unique symbol;

interface _ImmediateBase<out T, out S extends ImmediateState.Initial> extends HasState<S> {
  [_value]?: { value: T };
}

declare const _rejecting: unique symbol;

export interface _Immediate<T, S extends ImmediateState.Initial = ImmediateState>
  extends _ImmediateBase<T, S>, PromiseLike<T> {
  readonly value?: ValueOf<this>;
  readonly error?: unknown;

  isResolved(): this is Immediate.Resolved<T>;
  isResolved<T1 = T, S1 extends ImmediateState.Initial = S>(
    this: _Immediate<T1, S1>,
  ): this is Immediate.Resolved<T1>;
  isRejected<T1 = T, S1 extends ImmediateState.Initial = S>(
    this: Immediate<T1, S1>,
  ): this is Immediate<never, S1> & Immediate.Rejected<T1>;
  isSettled(): this is Immediate<T, ImmediateState.Settled>;
  isSettled<T1 = T, S1 extends ImmediateState.Initial = S>(
    this: _Immediate<T1, S1>,
  ): this is Immediate<T1, ImmediateState.Settled>;

  then<TResult1 = T, TResult2 = never>(
    onResolve?: ((value: ValueOf<this>) => ImmediateInput<TResult1, S | ImmediateState.Resolved>) | null,
    onReject?: ((error: unknown) => ImmediateInput<TResult2, ImmediateState.Rejected>) | null,
  ): Immediate<TResult1, S>;
  then<
    A1 extends Immediate<TResult1, S1> = never,
    A2 extends Immediate<TResult2, S2> = never,
    TResult1 = T,
    TResult2 = never,
    S1 extends ImmediateState = ImmediateState.For<A1>,
    S2 extends ImmediateState = ImmediateState.For<A2>,
  >(
    onResolve?: ((value: ValueOf<this>) => A1 | ImmediateInput<TResult1, S1>) | null,
    onReject?: ((error: unknown) => A2 | ImmediateInput<TResult2, S2>) | null,
  ): Immediate<TResult1 | TResult2, NoInfer<ImmediateState.Then<S1, S1, S2>>>;

  then<TResult1 = T, TResult2 = never>(
    onResolve?: ((value: ValueOf<this>) => ImmediateInput<TResult1>) | null,
    onReject?: ((error: unknown) => ImmediateInput<TResult2>) | null,
  ): Immediate<TResult1 | TResult2>;

  catch<TResult2 = never>(
    onReject?: ((error: unknown) => ImmediateInput<TResult2, ImmediateState.Rejected>) | null,
  ): Immediate<ValueOf<this> | TResult2, S>;
  catch<
    A2 extends Immediate<TResult2, S2> = never,
    TResult2 = never,
    S2 extends ImmediateState = ImmediateState.For<A2>,
  >(
    onReject?: ((error: unknown) => A2 | ImmediateInput<TResult2, S2>) | null,
  ): Immediate<ValueOf<this> | TResult2, ImmediateState.Then<S, S, S2>>;

  catch<TResult2 = never>(
    onReject?: ((error: unknown) => ImmediateInput<TResult2>) | null,
  ): Immediate<ValueOf<this> | TResult2>;

  finally(onfinally?: () => ImmediateInput<void, ImmediateState.Resolved>): Immediate<ValueOf<this>, S>;
  finally<
    A1 extends ImmediateInput<T, S1>,
    T = void,
    S1 extends ImmediateState.Initial = ImmediateState.For<A1>,
  >(
    onfinally?: (() => A1 | ImmediateInput<T, S1>) | null,
  ): Immediate<ValueOf<this>, ImmediateState.Finally<S1, S1>>;
  finally(onfinally?: () => ImmediateInput<void>): Immediate<ValueOf<this>>;
  finally(onfinally?: () => unknown): Immediate<ValueOf<this>>;
}

type ImmediateInner<T, S> = ([S] extends [ImmediateState.Rejected] ? Immediate.Rejected<T, S> : unknown)
  & ([S] extends [ImmediateState.Resolved] ? Immediate.Resolved<T, S> : unknown);

export type Immediate<T, S extends ImmediateState.Initial = ImmediateState> =
  ImmediateInner<T, S> extends infer _I extends _Immediate<T, S> ? _I : _Immediate<T, S>;

export type ImmediateInput<T, S extends ImmediateState.Initial = ImmediateState> =
  // | Exclude<T, Promise<any> | PromiseLike<any>>
  | T
  | _Immediate<T, S>
  | (S extends ImmediateState.Resolved | ImmediateState.Rejected ? never : PromiseLike<T> | Promise<T>);

export namespace Immediate {
  interface _Rejected<S extends ImmediateState.Rejected> extends _ImmediateBase<never, S> {
    error: unknown;
  }

  export type Rejected<_T, S extends ImmediateState.Rejected = ImmediateState.Rejected> = _Immediate<
    never,
    S
  >
    & _Rejected<S>;

  interface _Resolved<T, S extends ImmediateState.Resolved> extends _ImmediateBase<T, S> {
    value: T;
    error?: never;
  }

  export type Resolved<T, S extends ImmediateState.Resolved = ImmediateState.Resolved> = _Immediate<T, S>
    & _Resolved<T, S>;

  interface _Rejecting<S extends ImmediateState.Initial> extends _ImmediateBase<never, S> {
    [_rejecting]: typeof _rejecting;
  }

  export type Rejecting<_T = never, S extends ImmediateState.Initial = ImmediateState> = Immediate<never, S>
    & _Rejecting<S>;
}

type ImmediateInputOfArray<
  T extends readonly unknown[],
  S extends readonly ImmediateState.Initial[] = ImmediateState.Initial[],
> = AssumeSubtype<
  readonly ImmediateInput<T[number], S[number]>[],
  { [Idx in keyof T]: ImmediateInput<T[Idx], S[Idx & keyof S]> }
>;

type ValueOfRace<T extends readonly unknown[], S extends readonly ImmediateState.Initial[]> =
  [T, S] extends [readonly [infer X, ...any], readonly [ImmediateState.Settled, ...any]] ? X
  : [T, S] extends (
    [
      readonly [infer T1, ...infer T2],
      readonly [any, ...infer S2 extends readonly ImmediateState.Initial[]],
    ]
  ) ?
    T1 | ValueOfRace<T2, S2>
  : T[number];

type AwaitedValueOfArray<A extends readonly unknown[]> = AssumeSubtype<
  readonly AwaitedValueOf<A[number]>[],
  { readonly [Idx in keyof A]: AwaitedValueOf<A[Idx]> }
>;

interface MappingObject {
  readonly [k: string]: unknown;
}

type ImmediateInputOfObject<
  T extends MappingObject,
  S extends ImmediateState.Initial = ImmediateState,
> = EnforceSubtype<MappingObject, { [Idx in keyof T as Idx & string]: ImmediateInput<T[Idx], S> }>;

type AwaitedValueOfObject<A extends MappingObject> = EnforceSubtype<
  MappingObject,
  { -readonly [Idx in keyof A as Idx & string]: AwaitedValueOf<A[Idx]> }
>;

type PropsOf<T> = T extends { [_ in keyof T]: infer V } ? V : T[keyof T];

export interface ImmediateConstructor extends ImmediateStatics {
  new <T>(
    executor: (resolve: (value: Awaitable<T>) => void, reject: (error?: unknown) => void) => void,
  ): Immediate<T>;

  prototype: Immediate<unknown>;
}

export interface ImmediateStatics {
  resolve(): Immediate.Resolved<void>;
  resolve<A extends Immediate<any>>(value: A): A;
  resolve<
    A extends ImmediateInput<T, S>,
    T = AwaitedValueOf<A>,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    value: A | ImmediateInput<T>,
  ): Immediate<T, S>;
  resolve<T, S extends ImmediateState.Initial = ImmediateState.Resolved>(
    value: ImmediateInput<T, S>,
  ): Immediate<T, S>;

  reject<T = never>(): Immediate<T, ImmediateState.Rejected>;
  reject<A extends Immediate<T, ImmediateState.Rejected>, T = never>(value: A): A;
  reject<T = never>(value: Immediate<T, ImmediateState.Settled>): Immediate.Rejected<T>;
  reject<T = never>(
    value: Immediate<any, ImmediateState.Resolved | ImmediateState.Rejected>,
  ): Immediate<T, ImmediateState.Rejected>;

  reject<
    A extends ImmediateInput<U, S>,
    U = AwaitedValueOf<A>,
    T = never,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    value: A | ImmediateInput<U, S>,
  ): Immediate<T, ImmediateState.Then<S, ImmediateState.Rejected>>;
  reject<
    A extends ImmediateInput<U, S>,
    U = AwaitedValueOf<A>,
    T = never,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    value: A | ImmediateInput<U>,
  ): Immediate<T, ImmediateState.Then<S, ImmediateState.Rejected>>;

  reject<T, S extends ImmediateState.Initial = ImmediateState>(
    value: ImmediateInput<T, S>,
  ): Immediate<T, ImmediateState.Then<S, ImmediateState.Rejected>>;

  all<
    const A extends ImmediateInputOfArray<T, S[]>,
    T extends readonly unknown[] = AwaitedValueOfArray<A>,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    values: A,
  ): Immediate<T, StateOfAll<A>>;
  all<
    I extends Iterable<A>,
    A extends ImmediateInput<T, S> = ItemOf<I>,
    T = AwaitedValueOf<A>,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    values: I,
  ): Immediate<T[], S>;
  all<
    A extends ImmediateInputOfObject<T, S>,
    T extends MappingObject = AwaitedValueOfObject<A>,
    S extends ImmediateState.Initial = ImmediateState.For<PropsOf<A>>,
  >(
    values: A,
  ): Immediate<T, S>;

  any<
    const A extends readonly ImmediateInput<T, S>[],
    T = AwaitedValueOf<A[number]>,
    S extends ImmediateState.Initial = ImmediateState.For<A[number]>,
  >(
    values: A,
  ): Immediate<T, S>;
  any<
    A extends ImmediateInput<T, S>,
    T = AwaitedValueOf<A>,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    values: Iterable<A>,
  ): Immediate<T, S>;
  any<T, S extends ImmediateState.Initial = ImmediateState>(
    values: Iterable<ImmediateInput<T, S>>,
  ): Immediate<T, S>;

  race<
    const A extends ImmediateInputOfArray<T, S>,
    T extends readonly unknown[] = AwaitedValueOfArray<A>,
    S extends readonly ImmediateState.Initial[] = ImmediateStatesOfArray<A>,
  >(
    values: A,
  ): Immediate<ValueOfRace<T, ImmediateStatesOfArray<A>>, StateOfRace<A>>;
  race<
    A extends ImmediateInput<T, S>,
    T = AwaitedValueOf<A>,
    S extends ImmediateState.Initial = ImmediateState.For<A>,
  >(
    values: Iterable<A>,
  ): Immediate<T, S>;
  race<T, S extends ImmediateState.Initial = ImmediateState>(
    values: Iterable<ImmediateInput<T, S>>,
  ): Immediate<T, S>;

  try<
    A extends ImmediateInput<T, K>,
    T = AwaitedValueOf<A>,
    Args extends readonly unknown[] = [],
    K extends ImmediateState.Initial = ImmediateState,
  >(
    fn: (...args: Args) => ImmediateInput<T, K>,
    ...args: Args
  ): Immediate<T, K>;
  try<T, Args extends readonly unknown[] = [], K extends ImmediateState.Initial = ImmediateState>(
    fn: (...args: Args) => ImmediateInput<T, K>,
    ...args: Args
  ): Immediate<T, K>;

  isImmediate<A extends ImmediateInput<T>, T = AwaitedValueOf<A>>(
    value: A & ImmediateInput<T>,
  ): value is SoftIntersect<A, Immediate<T>>;
  isImmediate<T>(value: ImmediateInput<T>): value is Immediate<T>;

  readonly NEVER: Immediate<never>;
}

export const Immediate = _ImmediateImpl as unknown as ImmediateConstructor;

export { immediate, type ImmediateGenerator } from './immediate/gen.ts';
