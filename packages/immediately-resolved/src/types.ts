import type { _Immediate, Immediate } from './immediate.ts';

export type Awaitable<T> = T | PromiseLike<T>;

export type Preserve<T> = T extends T ? T : T;

export type EvaluationKindOf<T> =
  T extends _Immediate<infer _T, infer _K> ? NonNullable<T[typeof _evaluationKind]>
  : T extends PromiseLike<infer _T> ? EvaluationKind.Async
  : T extends Awaitable<infer _T> ?
    PromiseLike<_T> extends T ?
      EvaluationKind
    : EvaluationKind.Sync
  : EvaluationKind;

declare const _syncKind: unique symbol;
declare const _asyncKind: unique symbol;
export declare const _evaluationKind: unique symbol;

export type EvaluationKind = EvaluationKind.Sync | EvaluationKind.Async;

export interface _EvaluationKind {
  [_evaluationKind]: symbol;
}

export namespace EvaluationKind {
  export interface Sync extends Async {
    readonly [_evaluationKind]: typeof _syncKind;
  }
  export interface Async extends _EvaluationKind {
    readonly [_evaluationKind]: typeof _syncKind | typeof _asyncKind;
  }
}

export type EvaluationKindOfRace<A extends Iterable<unknown>> =
  A extends readonly unknown[] ?
    true extends (
      { [Idx in keyof A]: EvaluationKindOf<A[Idx]> extends EvaluationKind.Sync ? true : false }[number]
    ) ?
      EvaluationKind.Sync
    : EvaluationKind
  : EvaluationKindOf<ItemOf<A>>;

export type ImmediateInput<T, K extends EvaluationKind = EvaluationKind> =
  | T
  | _Immediate<T, K>
  | (EvaluationKind.Async extends K ? PromiseLike<T> : never);

export type AwaitedValue<A> = A extends Immediate<infer T> | Awaitable<infer T> ? T : unknown;

export type AsAwaitable<A> = A | ImmediateInput<AwaitedValue<A>>;

export type ItemOf<It> = It extends Iterable<infer T, any, never> ? T : unknown;

export type MustExtend<Super, Sub extends Super> =
  Sub extends infer _Sub extends Super ? Sub & _Sub : Sub & Super;
