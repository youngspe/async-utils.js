import assert from 'node:assert/strict';
import { Immediate, type AwaitedValueOf, type ImmediateInput } from './immediate.js';
import type { Preserve } from './types.ts';
import type { ImmediateState } from './state.ts';
import {
  TypeAssert,
  type IfValid,
  type Extends,
  type IfSatisfies,
  type Not,
} from '@private/test-utils/type-assert';

export const verifyResolved = <T>(value: Immediate.Resolved<T>) => assert(value.isResolved());
export const verifyRejected = <T>(value: Immediate.Rejected<T>) => assert(value.isRejected());
export const verifySettled = <T>(value: ImmediateInput<T, ImmediateState.Settled>) =>
  assert(Immediate.resolve(value).isSettled());

export const verifyNotComplete = <
  A extends ImmediateInput<T, S>,
  T = AwaitedValueOf<A>,
  S extends ImmediateState = ImmediateState.For<A>,
>(
  value: [S] extends [ImmediateState.Settled] ? ['expected', A, 'not to be completed'] : A,
) => assert(!Immediate.resolve(value).isSettled());

export const verifyImmediate = <A>(value: A) => ({
  resolvesTo<T>(..._: IfSatisfies<A, Extends<ImmediateInput<T, ImmediateState.Resolved>>, []> & unknown[]) {
    return this;
  },
  resolved: <T = AwaitedValueOf<A>>(
    ..._: IfSatisfies<A, Extends<ImmediateInput<T, ImmediateState.Resolved>>, []> & unknown[]
  ) => {
    assert(Immediate.resolve(value as ImmediateInput<T>).isResolved());
  },
  rejected: <T = AwaitedValueOf<A>>(
    ..._: IfSatisfies<A, Extends<ImmediateInput<T, ImmediateState.Rejected>>, []> & unknown[]
  ) => {
    assert(Immediate.resolve(value as ImmediateInput<T>).isRejected());
  },
  settled: <T = AwaitedValueOf<A>>(
    ..._: IfSatisfies<A, Extends<ImmediateInput<T, ImmediateState.Settled>>, []> & unknown[]
  ) => {
    assert(Immediate.resolve(value as ImmediateInput<T>).isRejected());
  },
  notSettled: <T = AwaitedValueOf<A>>(
    ..._: IfSatisfies<A, Not<Extends<ImmediateInput<T, ImmediateState.Settled>>>, []> & unknown[]
  ) => {
    assert(Immediate.resolve(value as ImmediateInput<T>).isRejected());
  },
  get is() {
    return this;
  },
});

verifyImmediate(0).is.rejected();
