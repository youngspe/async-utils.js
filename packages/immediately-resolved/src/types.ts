import type { _Immediate, Immediate } from './immediate.ts';

export type Awaitable<T> = T | PromiseLike<T>;

export type Preserve<T> = {} extends T ? T : T;

declare const _asyncKind: unique symbol;

export declare const _kind: unique symbol;

export type AsAwaitable<A> = A | Immediate<unknown> | PromiseLike<unknown>;

export type ItemOf<It> = It extends Iterable<infer T, any, never> ? T : unknown;

type _Subtype<Super, Sub extends Super> = Sub;

export type AssumeSubtype<Super, Sub> = _Subtype<
  Super,
  Sub extends infer _Sub extends Super ? Sub & _Sub : Sub & Super
>;

export type EnforceSubtype<Super, Sub extends Super> = AssumeSubtype<Super, Sub>;

export type SoftIntersect<A, B> =
  A extends infer _A extends B ? A & _A
  : B extends infer _B extends A ? B & _B
  : A & B;

export type SubtypeOrNever<Super, Sub> = EnforceSubtype<Super, [Sub] extends [Super] ? Sub : never>;
