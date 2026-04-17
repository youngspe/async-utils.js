import type { Awaitable } from '@youngspe/async-scope-common';

import type { AnyFlow, Flow } from '../../flow.ts';
import type { Falsy } from '../../types.ts';

export type FlowOperator<in A extends AnyFlow = Flow<never, never, any>, out B = unknown> = (
  this: void,
  src: A,
) => B;

export type FlowTransformer<
  in A extends AnyFlow = Flow<never, never, any>,
  out U = unknown,
  out UReturn = unknown,
  in UNext = never,
> = FlowOperator<A, Flow<U, UReturn, UNext>>;

export type FlowInspector<in out T, in out TReturn, in out TNext> = FlowTransformer<
  Flow<T, TReturn, TNext>,
  T,
  TReturn,
  TNext
>;

export type FlowCollector<in A extends AnyFlow = Flow<never, never, any>, out B = unknown> = FlowOperator<
  A,
  Promise<B>
>;

export function pipeFlows<A extends AnyFlow>(src: A): A;
export function pipeFlows<A extends AnyFlow, B>(src: A, opA: FlowOperator<A, B>): B;
export function pipeFlows<A extends AnyFlow, B extends AnyFlow, C>(
  src: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
): C;
export function pipeFlows<A extends AnyFlow, B extends AnyFlow, C extends AnyFlow, D>(
  src: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
): D;
export function pipeFlows<A extends AnyFlow, B extends AnyFlow, C extends AnyFlow, D extends AnyFlow, E>(
  src: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
): E;
export function pipeFlows<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F,
>(
  src: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
): F;
export function pipeFlows<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F extends AnyFlow,
  G,
>(
  src: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
  opF: FlowOperator<F, G>,
): G;
export function pipeFlows<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F extends AnyFlow,
  G extends AnyFlow,
  H extends AnyFlow,
>(
  src: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
  opF: FlowOperator<F, G>,
  opG: FlowOperator<G, H>,
  ...ops: FlowOperator<H, H>[]
): H;
export function pipeFlows(src: AnyFlow, ...ops: FlowOperator<AnyFlow, unknown>[]): unknown {
  let value: unknown = src;

  for (const op of ops) {
    value = op(value as AnyFlow);
  }

  return value;
}

export function compose<A extends AnyFlow>(): FlowOperator<A, A>;
export function compose<A extends AnyFlow, B>(opA: FlowOperator<A, B>): FlowOperator<A, B>;
export function compose<A extends AnyFlow, B extends AnyFlow, C>(
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
): FlowOperator<A, C>;
export function compose<A extends AnyFlow, B extends AnyFlow, C extends AnyFlow, D>(
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
): FlowOperator<A, D>;
export function compose<A extends AnyFlow, B extends AnyFlow, C extends AnyFlow, D extends AnyFlow, E>(
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
): FlowOperator<A, E>;
export function compose<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F,
>(
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
): FlowOperator<A, F>;
export function compose<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F extends AnyFlow,
  G,
>(
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
  opF: FlowOperator<F, G>,
): FlowOperator<A, G>;
export function compose<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F extends AnyFlow,
  G extends AnyFlow,
  H extends AnyFlow,
>(
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
  opF: FlowOperator<F, G>,
  opG: FlowOperator<G, H>,
  ...ops: FlowOperator<H, H>[]
): FlowOperator<A, H>;
export function compose(...ops: FlowOperator<AnyFlow, unknown>[]): unknown {
  return (src: AnyFlow) => {
    let value: unknown = src;

    for (const op of ops) {
      value = op(value as AnyFlow);
    }

    return value;
  };
}

export function pipeThis<A extends AnyFlow>(this: A): A;
export function pipeThis<A extends AnyFlow, B>(this: A, opA: FlowOperator<A, B>): B;
export function pipeThis<A extends AnyFlow, B extends AnyFlow, C>(
  this: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
): C;
export function pipeThis<A extends AnyFlow, B extends AnyFlow, C extends AnyFlow, D>(
  this: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
): D;
export function pipeThis<A extends AnyFlow, B extends AnyFlow, C extends AnyFlow, D extends AnyFlow, E>(
  this: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
): E;
export function pipeThis<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F,
>(
  this: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
): F;
export function pipeThis<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F extends AnyFlow,
  G,
>(
  this: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
  opF: FlowOperator<F, G>,
): G;
export function pipeThis<
  A extends AnyFlow,
  B extends AnyFlow,
  C extends AnyFlow,
  D extends AnyFlow,
  E extends AnyFlow,
  F extends AnyFlow,
  G extends AnyFlow,
  H extends AnyFlow,
>(
  this: A,
  opA: FlowOperator<A, B>,
  opB: FlowOperator<B, C>,
  opC: FlowOperator<C, D>,
  opD: FlowOperator<D, E>,
  opE: FlowOperator<E, F>,
  opF: FlowOperator<F, G>,
  opG: FlowOperator<G, H>,
  ...ops: FlowOperator<H, H>[]
): H;
export function pipeThis(this: AnyFlow, ...ops: FlowOperator<AnyFlow, unknown>[]): unknown {
  let value: unknown = this;

  for (const op of ops) {
    value = op(value as AnyFlow);
  }

  return value;
}

export type AsyncPredicate<A extends readonly unknown[]> = (
  ...args: A
) => Awaitable<true | NonNullable<unknown> | Falsy>;

export const ident = <T>(value: T): T => value;
