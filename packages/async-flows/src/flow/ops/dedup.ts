import { Token, type Subscription, type TokenController } from '@youngspe/async-scope';
import { isNonDeferredFlowError } from '../abstract.ts';
import { defineFlow } from '../util.ts';
import type { FlowInspector } from './module.ts';

/**
 * Suppresses duplicate values from the flow based on a key derived from each value.
 * Only emits values whose key differs from the most recent emitted value's key.
 *
 * When a value with a key equal to the previous key is received, the prior value's
 * cancellation token is paused rather than cancelled, allowing the new value to supersede
 * the previous one without tearing down its resources immediately.
 *
 * @param getKey - Function to extract a key from each value
 * @param eq - Equality function for comparing keys (defaults to `Object.is`)
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { dedupByKey } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(
 *   { id: 1, name: 'a' },
 *   { id: 1, name: 'b' },
 *   { id: 2, name: 'c' },
 *   { id: 1, name: 'd' },
 * ).do(dedupByKey(x => x.id));
 *
 * await flow.each(({ value }) => console.log(value.name));
 * // Output:
 * // a
 * // c
 * // d
 * ```
 */
export const dedupByKey =
  <T, TReturn, TNext, K>(
    getKey: (this: void, value: T) => K,
    eq: (this: void, oldKey: K, newKey: K) => boolean = Object.is,
  ): FlowInspector<T, TReturn, TNext | undefined> =>
  src =>
    defineFlow(({ emitScoped, scope }) => {
      let state: { key: K; ctrl: TokenController; sub?: Subscription | undefined } | undefined;
      return src.each(
        ({ value, token }) => {
          const newKey = getKey(value);

          token = token.filter(e => !isNonDeferredFlowError(e));

          if (state) {
            if (eq(state.key, newKey)) {
              state.sub?.dispose();
              state.sub = token.add(state.ctrl);
              return;
            }

            state.ctrl.defuse();
          }

          const ctrl = Token.createController();
          ctrl.token.add(() => {
            state = undefined;
          });

          state = { key: newKey, ctrl, sub: token.add(ctrl) };

          return emitScoped({ value, scope: ctrl });
        },
        { scope },
      );
    });

/**
 * Suppresses consecutive duplicate values from the flow. Only emits a value if it differs from the
 * most recently emitted value.
 *
 * @param eq - Equality function for comparing values (defaults to `Object.is`)
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { dedup } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 1, 2, 2, 3, 1, 1).do(dedup());
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // 1
 * ```
 */
export const dedup = <T, TReturn, TNext>(
  eq: (this: void, oldValue: T, newValue: T) => boolean = Object.is,
): FlowInspector<T, TReturn, TNext | undefined> => dedupByKey(x => x, eq);
