import type { Awaitable } from '@youngspe/async-scope-common';
import type { ScopeContext } from '@youngspe/async-scope';

import { defineFlow } from '#pkg/flow/util';
import type { Falsy } from '#pkg/types';

import { ident, type FlowInspector } from './module.ts';

/**
 * Calls the given function for each value when the flow is observed.
 * The function receives each yielded value without modifying it.
 *
 * @param onEach - Function called with each value. If falsy, the operator is a no-op.
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { inspect } from '@youngspe/async-flows/ops';
 *
 * const numbers = flowOf(1, 2, 3);
 * const logged = numbers.do(inspect(value => console.log('Value:', value)));
 *
 * await logged.each(({ value }) => console.log(value));
 * // Output:
 * // Value: 1
 * // 1
 * // Value: 2
 * // 2
 * // Value: 3
 * // 3
 * ```
 */
export const inspect = <T, TReturn, TNext>(
  onEach: ((value: T) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onEach ? ident : (
    src =>
      src.transformEach(async ({ value, emit }) => {
        await onEach(value);
        return emit(value);
      })
  );

/**
 * Calls the given function for each value with access to the scope context.
 * The function receives a `ScopeContext` wrapping the value and can use scope features
 * (e.g., `scope.delay()`) without modifying the value.
 *
 * @param onEach - Function called with a scope context for each value. If falsy, the operator is a no-op.
 */
export const inspectScoped = <T, TReturn, TNext>(
  onEach: ((cx: ScopeContext<{ value: T }>) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onEach ? ident : (
    src =>
      src.transformEach(async ({ value, emit, scope }) => {
        await onEach(scope.getContext({ values: { value } }));
        return emit(value);
      })
  );

/**
 * Calls the given function for each input value sent back into the flow.
 * This allows observing the values that consumers pass back via the iterator's `next()` call.
 *
 * @param onInput - Function called with each input value. If falsy, the operator is a no-op.
 */
export const inspectInput = <T, TReturn, TNext>(
  onInput: ((value: TNext) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onInput ? ident : (
    src =>
      src.transformEach(async ({ value, emit }) => {
        const input = await emit(value);
        await onInput(input);
        return input;
      })
  );

/**
 * Calls the given function for each input value with access to the scope context.
 * Allows observing input values with scope features available.
 *
 * @param onInput - Function called with a scope context for each input value. If falsy, the operator is a no-op.
 */
export const inspectInputScoped = <T, TReturn, TNext>(
  onInput: ((cx: ScopeContext<{ value: TNext }>) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onInput ? ident : (
    src =>
      src.transformEach(async ({ value, emit, scope }) => {
        const input = await emit(value);
        await onInput(scope.getContext({ values: { value: input } }));
        return input;
      })
  );

/**
 * Calls the given function when the flow completes successfully, and optionally when it errors.
 *
 * @param onComplete - Function called with the flow's return value on success. If falsy, no-op on success.
 * @param onError - Optional function called with the error if the flow fails.
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { inspectComplete } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3).do(inspectComplete(value => console.log('Done:', value)));
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 1
 * // 2
 * // 3
 * // Done: undefined
 * ```
 */
export const inspectComplete = <T, TReturn, TNext>(
  onComplete: ((value: TReturn) => Awaitable<void>) | Falsy,
  onError?: ((error: unknown) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onComplete && !onError ?
    ident
  : src =>
      defineFlow(async ({ emitAll }) => {
        let value;
        try {
          value = await emitAll(src);
        } catch (error) {
          if (onError) {
            await onError(error);
          }
          throw error;
        }
        if (onComplete) {
          await onComplete(value);
        }
        return value;
      });

/**
 * Calls the given function when the flow completes (or errors), with access to the scope context.
 *
 * @param onComplete - Function called with a scope context containing the return value on success
 * @param onError - Optional function called with a scope context containing the error if the flow fails
 */
export const inspectCompleteScoped = <T, TReturn, TNext>(
  onComplete: ((cx: ScopeContext<{ value: TReturn }>) => Awaitable<void>) | Falsy,
  onError?: ((cx: ScopeContext<{ error: unknown }>) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onComplete && !onError ?
    ident
  : src =>
      defineFlow(async ({ emitAll, scope }) => {
        let value;

        try {
          value = await emitAll(src);
        } catch (error) {
          if (onError) {
            await onError(scope.getContext({ values: { error } }));
          }
          throw error;
        }
        if (onComplete) {
          await onComplete(scope.getContext({ values: { value } }));
        }
        return value;
      });

/**
 * Calls the given function when the flow encounters an error.
 *
 * @param onError - Function called with the error when the flow fails. If falsy, the operator is a no-op.
 *
 * @example
 * ```ts
 * import { defineFlow } from '@youngspe/async-flows';
 * import { inspectError } from '@youngspe/async-flows/ops';
 *
 * const failingFlow = defineFlow(async ({ emit }) => {
 *   await emit(1);
 *   throw new Error('Test error');
 * });
 *
 * const logged = failingFlow.do(inspectError(error => console.log(String(error))));
 *
 * await logged.each(() => {}).catch(() => {});
 * // Output:
 * // Error: Test error
 * ```
 */
export const inspectError = <T, TReturn, TNext>(
  onError?: ((error: unknown) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> => inspectComplete(undefined, onError);

/**
 * Calls the given function when the flow encounters an error, with access to the scope context.
 *
 * @param onError - Function called with a scope context containing the error. If falsy, the operator is a no-op.
 */
export const inspectErrorScoped = <T, TReturn, TNext>(
  onError?: ((cx: ScopeContext<{ error: unknown }>) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> => inspectCompleteScoped(undefined, onError);

/**
 * Calls the given function at the end of the flow, regardless of whether it completed successfully
 * or with an error. The callback receives a scope context that includes the return value (on success)
 * or the error (on failure).
 *
 * @param onFinally - Function called with a scope context containing the result or error
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { inspectFinally } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3);
 * const finallyLogged = flow.do(
 *   inspectFinally(cx => console.log('Finally:', cx.error ? 'error' : 'success')),
 * );
 *
 * await finallyLogged.each(() => {}).catch(() => {});
 * // Output:
 * // Finally: success
 * ```
 */
export const inspectFinally = <T, TReturn, TNext>(
  onFinally?:
    | ((
        cx:
          | ScopeContext<{ value: TReturn; error?: unknown }>
          | ScopeContext<{ value?: never; error: unknown }>,
      ) => Awaitable<void>)
    | Falsy,
): FlowInspector<T, TReturn, TNext> => inspectCompleteScoped<T, TReturn, TNext>(onFinally, onFinally);

/**
 * Calls the given function at the start of the flow, before any values are emitted.
 *
 * @param onStart - Function called with a scope context when the flow begins. If falsy, the operator is a no-op.
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { inspectStart } from '@youngspe/async-flows/ops';
 *
 * const started = flowOf(1, 2, 3)
 *   .do(inspectStart(() => console.log('Starting...')));
 *
 * await started.each(({ value }) => console.log(value));
 * // Output:
 * // Starting...
 * // 1
 * // 2
 * // 3
 * ```
 */
export const inspectStart = <T, TReturn, TNext>(
  onStart: ((cx: ScopeContext) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> =>
  !onStart ? ident : (
    src =>
      defineFlow(async ({ emitAll, scope }) => {
        await onStart(scope.getContext());
        return emitAll(src);
      })
  );
