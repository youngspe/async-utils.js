import type { FlowTransformer } from './module.ts';
import { sharedFlow, type SharedFlowOptions } from '#pkg/flow/shared';
import type { Flow } from '#pkg/flow/flow';

/**
 * Shares a flow instance between multiple consumers.
 * The flow is started (or restarted) when a consumer is added (e.g. by calling `each()`) and
 * cancelled when all consumers are cancelled.
 *
 * @param options - Configuration for the shared flow behavior
 *
 * @example
 * ```ts
 * import { defineFlow, Scope } from '@youngspe/async-flows';
 * import { share } from '@youngspe/async-flows/ops';
 *
 * const data = defineFlow<number>(async ({ emit, scope }) => {
 *   console.log('Starting flow');
 *   await scope.delay(10);
 *   await emit(1);
 *   await scope.delay(10);
 *   await emit(2);
 *   await scope.delay(10);
 *   await emit(3);
 *   console.log('Ending flow');
 * });
 *
 * const shared = data.do(share({}));
 *
 * await Scope.static.launchAll([
 *   () => shared.each(async ({ value }) => console.log(`A:${value}`)),
 *   async ({ scope }) => {
 *     await scope.delay(15);
 *     await shared.each(async ({ value }) => console.log(`B:${value}`));
 *   },
 * ]);
 * // Output:
 * // Starting flow
 * // A:1
 * // A:2
 * // B:2
 * // A:3
 * // B:3
 * // Ending flow
 * ```
 */
export const share =
  <T, TReturn>(
    options: SharedFlowOptions,
  ): FlowTransformer<Flow<T, TReturn, undefined>, T, TReturn, unknown> =>
  src => {
    return sharedFlow({
      ...options,
      onInit: undefined,
      onResume: undefined,
      onStart: ({ scope, emit, fail, complete }) => {
        src.each(({ value, scope }) => emit(value, { scope }), { scope }).then(complete, fail);
      },
    });
  };
