import {
  lifecycleFromFlow,
  standardLifecycleFromFlow,
  type GenericLifecycle,
  type StandardLifecycle,
  type StandardLifecycleState,
} from '../../lifecycle.ts';
import type { Flow } from '#pkg/flow';
import type { FlowOperator } from '#pkg/flow/ops';

/**
 * Creates a {@link GenericLifecycle} from a flow that yields the current lifecycle state.
 *
 *
 */
export function lifecycle<const A extends readonly K[], const K extends PropertyKey = A[number]>(
  states: A,
): FlowOperator<Flow<K | undefined, unknown, undefined>, GenericLifecycle<K>>;
export function lifecycle<const K extends PropertyKey>(
  states: readonly K[],
): FlowOperator<Flow<K | undefined, unknown, undefined>, GenericLifecycle<K>>;
export function lifecycle<const K extends PropertyKey>(
  states: readonly K[],
): FlowOperator<Flow<K | undefined, unknown, undefined>, GenericLifecycle<K>> {
  return src => lifecycleFromFlow(src, states);
}

/**
 * Creates a {@link StandardLifecycle} from a flow that yields the current lifecycle state.
 */
export const standardLifecycle =
  (): FlowOperator<Flow<StandardLifecycleState | undefined, unknown, undefined>, StandardLifecycle> =>
  src =>
    standardLifecycleFromFlow(src);
