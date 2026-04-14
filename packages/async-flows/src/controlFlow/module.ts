import type { Awaitable } from '@youngspe/async-scope-common';
import type { ControlFlow } from '../controlFlow.ts';
import type { OptionalUndefinedParams } from '@youngspe/common-async-utils';

interface _OptionalWithUndefined {
  readonly x?: undefined;
}

interface _OptionalWithNever {
  readonly x?: never;
}

type _ExactOptionalPropertyTypesEnabled = _OptionalWithUndefined extends _OptionalWithNever ? false : true;

type IfExactOptionalPropertyTypes<True = true, False = false> =
  _ExactOptionalPropertyTypesEnabled extends true ? True : False;

interface _ControlFlowBase<out B, out C> {
  readonly break?: B;
  readonly continue?: C;
}

interface ControlFlowBase<out B, out C> extends IfExactOptionalPropertyTypes<
  _ControlFlowBase<B, C>,
  NonNullable<unknown>
> {}

export interface Break<out B> extends ControlFlowBase<B, never> {
  readonly break: B;
}
export interface Continue<out C> extends ControlFlowBase<never, C> {
  readonly continue: C;
}

export type BreakValue<F extends ControlFlow> =
  F extends ControlFlow<never, any> ? never
  : F extends Break<any> ? F['break']
  : never;

export type ContinueValue<F extends ControlFlow> =
  F extends ControlFlow<any, never> ? never
  : F extends Continue<any> ? F['continue']
  : never;

export function isBreak<B, C>(value: ControlFlow<B, C>): value is Break<B> {
  return 'break' in value;
}

export function isContinue<B, C>(value: ControlFlow<B, C>): value is Continue<C> {
  return 'continue' in value;
}

export const BREAK: Break<undefined> = Object.freeze({ break: undefined });
export const CONTINUE: Continue<undefined> = Object.freeze({ continue: undefined });

export function Break<const B, C = never>(this: void, value: B): ControlFlow<B, C> {
  return { break: value };
}

export function Continue<const C, B = never>(this: void, value: C): ControlFlow<B, C> {
  return { continue: value };
}

export function unwrap<B, C>(this: void, value: ControlFlow<B, C>): B | C {
  return 'break' in value ? value.break : value.continue;
}

export function flatten<B1, C, B2 = B1>(
  this: void,
  value: ControlFlow<B1, ControlFlow<B1, C>>,
): ControlFlow<B1 | B2, C> {
  return 'continue' in value ? value.continue : value;
}

export function map<B1 = never, C1 = never, B2 = B1, C2 = C1>(
  this: void,
  value: ControlFlow<B1, C1>,
  mapContinue: (value: C1) => C2,
  mapBreak: (value: B1) => B2,
): ControlFlow<B2, C2>;
export function map<B1 = never, C1 = never, B2 = B1, C2 = C1>(
  this: void,
  value: ControlFlow<B1, C1>,
  mapContinue: (value: C1) => C2,
  mapBreak?: ((value: B1) => B2) | null,
): ControlFlow<B1 | B2, C2>;
export function map<B1 = never, C1 = never, B2 = B1, C2 = C1>(
  this: void,
  value: ControlFlow<B1, C1>,
  mapContinue: ((value: C1) => C2) | null | undefined,
  mapBreak: (value: B1) => B2,
): ControlFlow<B2, C1 | C2>;
export function map<B1 = never, C1 = never, B2 = B1, C2 = C1>(
  this: void,
  value: ControlFlow<B1, C1>,
  ...args: OptionalUndefinedParams<
    [
      mapContinue: ((value: C1) => C2) | (C1 extends C2 ? undefined | null : never),
      mapBreak: ((value: B1) => B2) | (B1 extends B2 ? undefined | null : never),
    ]
  >
): ControlFlow<B2, C2>;
export function map<B1 = never, C1 = never, B2 = B1, C2 = C1>(
  this: void,
  value: ControlFlow<B1, C1>,
  mapContinue?: ((value: C1) => C2) | null,
  mapBreak?: ((value: B1) => B2) | null,
): ControlFlow<B1 | B2, C1 | C2>;
export function map<B1, C1, B2 = B1, C2 = C1>(
  this: void,
  value: ControlFlow<B1, C1>,
  mapContinue?: ((value: C1) => C2) | null,
  mapBreak?: ((value: B1) => B2) | null,
): ControlFlow<B1 | B2, C1 | C2> {
  return (
    'continue' in value ?
      mapContinue ? { continue: mapContinue(value.continue) }
      : value
    : mapBreak ? { break: mapBreak(value.break) }
    : value
  );
}

export async function fromAsync<
  const F extends ControlFlow<B, C>,
  const B extends Awaitable<_B> = BreakValue<F>,
  const C extends Awaitable<_C> = ContinueValue<F>,
  const _B = B extends Awaitable<infer X> ? X : never,
  const _C = C extends Awaitable<infer X> ? X : never,
>(
  this: void,
  value: Awaitable<F | ControlFlow<B, C> | ControlFlow<Awaitable<_B>, Awaitable<_C>>>,
): Promise<ControlFlow<_B, _C>> {
  const _value = await value;

  return 'break' in _value ? { break: await _value.break } : { continue: await _value.continue };
}
