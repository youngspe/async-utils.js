import type { Awaitable, EnforceSubtype } from './types.ts';

interface SettledBase extends ImmediateState.Initial {
  resolve: 'done';
  reject?: 'done';
}

export namespace ImmediateState {
  export interface Initial {
    resolve?: 'pending' | 'done';
    reject?: 'pending' | 'done';
  }

  export interface Resolved extends SettledBase {
    resolve: 'done';
    reject?: never;
  }

  export interface Rejected extends Initial, SettledBase {
    resolve: 'done';
    reject: 'done';
  }

  export type Resolving = ImmediateState.Initial | ImmediateState.Resolved;
  export type Settled = Resolved | Rejected;
  export type For<T> =
    T extends HasState ? StateOf<T>
    : T extends PromiseLike<any> | Promise<any> ? ImmediateState
    : T extends Awaitable<infer _T> ?
      Promise<any> extends _T ?
        ImmediateState
      : ImmediateState.Resolved
    : ImmediateState;

  export type Then<
    S extends ImmediateState.Initial,
    SResolve extends ImmediateState.Initial = S,
    SReject extends ImmediateState.Initial = S,
  > =
    S & ImmediateState.Resolved extends never ? SReject | (SReject extends [never] ? S : never)
    : S | SResolve;

  export type Catch<
    S extends ImmediateState.Initial,
    SReject extends ImmediateState.Initial = never,
  > = Then<S, never, SReject>;

  export type Finally<S extends ImmediateState.Initial, SFinally extends ImmediateState.Initial> =
    | S
    | SFinally;
}

export type ImmediateState = ImmediateState.Rejected | ImmediateState.Resolving;

declare const _state: unique symbol;
export interface HasState<S extends ImmediateState.Initial = ImmediateState.Initial> {
  readonly [_state]?: S;
}
export type StateOf<I extends HasState> = NonNullable<I[typeof _state]>;

type _MatchingElements<S extends ObjectOrArray, X> = Extract<
  Element<{ [K in keyof S]: [S[K]] }>,
  [Element<S>] & [X]
>;

type _MatchingElementsOrDefault<
  S extends ObjectOrArray,
  X,
  Default,
  M extends [Element<S>] & [X] = _MatchingElements<S, X>,
> = [M] extends [never] ? Default : M[0];

type MatchingElementsOrDefault<
  S extends readonly unknown[] | Record<string, unknown>,
  X,
  Default,
> = _MatchingElementsOrDefault<S, X, Default>;

type FirstOrDefault<S extends readonly unknown[], X, Default> =
  S extends readonly [infer First extends X, ...any] ? First
  : S extends readonly [any, ...infer Rest] ? FirstOrDefault<Rest, X, Default>
  : S extends readonly never[] ? Default
  : S extends readonly (infer Item extends X)[] ? Item
  : Extract<S[number], X> | Default;

type _StateOfRace<S extends readonly ImmediateState.Initial[]> = FirstOrDefault<
  S,
  ImmediateState.Settled,
  S[number]
>;

export type StateOfRace<T extends readonly unknown[]> = _StateOfRace<ImmediateStatesOfEach<T>>;

export type ImmediateStatesOfEach<A> = { [K in keyof A]: ImmediateState.For<A[K]> };
export type ImmediateStatesOfArray<A extends readonly unknown[]> = EnforceSubtype<
  readonly ImmediateState.Initial[],
  { [K in keyof A]: ImmediateState.For<A[K]> }
>;

export type _StateOfAll<S extends ObjectOrArray<ImmediateState.Initial>> = EnforceSubtype<
  ImmediateState.Initial,
  MatchingElementsOrDefault<
    S,
    ImmediateState.Rejected,
    [Element<S>] extends [never] ? ImmediateState.Resolved : Element<S>
  >
>;

export type StateOfAll<T extends ObjectOrArray> = _StateOfAll<ImmediateStatesOfEach<T>>;

type ObjectOrArray<T = unknown> = readonly T[] | { readonly [k: PropertyKey]: T };

type Element<T> = T extends ObjectOrArray<infer X> ? X : never;
