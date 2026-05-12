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
 * The lifecycle will open an "in" handler when the state enters one of the given states,
 * and close the previous handler when the state changes.
 *
 * @param states - Array of valid lifecycle states
 *
 * @example
 * ```ts
 * import { Scope, Token } from '@youngspe/async-scope';
 * import { StateFlow } from '@youngspe/async-flows';
 * import { lifecycle } from '@youngspe/async-flows/ops';
 *
 * const { set: setState, stateFlow } = StateFlow.createController<'A' | 'B' | 'C' | undefined>();
 * const ls = stateFlow.do(lifecycle(['A', 'B', 'C']));
 *
 * await Scope.static.launchCancellable(async ({ scope }) => {
 *   setState('B');
 *   ls.in(
 *     {
 *       A: async () => console.log('open A'),
 *       B: async () => console.log('open B'),
 *       C: async () => console.log('open C'),
 *     },
 *   );
 *   await scope.delay(100);
 *   setState('C');
 * });
 * ```
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
 * Supports standard lifecycle states (`active`, `inactive`, `background`, etc.).
 *
 * @example
 * ```ts
 * import { StateFlow } from '@youngspe/async-flows';
 * import { standardLifecycle } from '@youngspe/async-flows/ops';
 *
 * const { stateFlow } = StateFlow.createController<'active' | 'inactive'>();
 * const ls = stateFlow.do(standardLifecycle());
 * ```
 */
export const standardLifecycle =
  (): FlowOperator<Flow<StandardLifecycleState | undefined, unknown, undefined>, StandardLifecycle> =>
  src =>
    standardLifecycleFromFlow(src);
