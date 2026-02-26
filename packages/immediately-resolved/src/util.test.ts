import assert from 'node:assert/strict';
import { Immediate, type ImmediateRejected, type ImmediateResolved } from './immediate.js';
import type { AwaitedValue, EvaluationKind, EvaluationKindOf, ImmediateInput, Preserve } from './types.ts';

export const verifyResolved = <T>(value: ImmediateResolved<T>) => assert(value.isResolved());
export const verifyRejected = <T>(value: ImmediateRejected<T>) => assert(value.isRejected());
export const verifyComplete = <T>(value: ImmediateInput<T, EvaluationKind.Sync>) =>
  assert(Immediate.resolve(value).isComplete());

export const verifyNotComplete = <
  A extends ImmediateInput<T, K>,
  T = AwaitedValue<A>,
  K extends EvaluationKind = EvaluationKindOf<A>,
>(
  value: Preserve<K> extends EvaluationKind.Sync ? ['expected', A, 'not to be completed'] : A,
) => assert(!Immediate.resolve(value).isComplete());
