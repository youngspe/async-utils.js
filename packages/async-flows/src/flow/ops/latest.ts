import { Scope, Token, type TokenController } from '@youngspe/async-scope';
import { defineFlow, Flow, NewItemReceived, toFlow, type ToFlow } from '../../flow.ts';
import { compose, type FlowTransformer } from './module.ts';
import { concatAll, map } from './transform.ts';
import { nestedMicrotask } from '@youngspe/common-async-utils';

/**
 * Emits only the latest value from the source flow, skipping intermediate values if the consumer
 * is not ready to receive them. When a new value arrives while the previous one is still being
 * processed, the new value replaces the pending one.
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { latest } from '@youngspe/async-flows/ops';
 *
 * await flow.each(async ({ value, scope }) => {
 *   console.log(value);
 *   await scope.delay(10);
 * });
 *
 * await flow.each(({ value }) => console.log(value));
 *
 * // Output:
 * // 1
 * // 3
 * ```
 */
export const latest =
  <T, TReturn = undefined, TNext = void>(): FlowTransformer<
    Flow<T, TReturn, TNext | undefined>,
    T,
    TReturn,
    TNext | undefined
  > =>
  src =>
    defineFlow(async ({ emitScoped, scope, cancel }) => {
      let emitting = false;
      let ctrl: TokenController | undefined;

      type Latest = { value: T; scope: Scope; resolve: (value: TNext | undefined) => void };

      let latest: Latest | undefined;

      const _emit = (value: T, scope: Scope) => {
        const currentCtrl = scope.tryUse(
          Token.createController({
            onBeforeCancel: () => {
              if (currentCtrl === ctrl) {
                ctrl = undefined;
              }
            },
          }),
        );

        if (!currentCtrl) return;
        ctrl = currentCtrl;

        const defer = (_latest: Latest) =>
          nestedMicrotask(8, () => {
            if (!latest) {
              emitting = false;
              return;
            }

            if (_latest !== latest) {
              latest.resolve(undefined);
              defer(latest);
              return;
            }

            latest = undefined;
            const { value, scope } = _latest;
            _emit(value, scope);
          });

        emitScoped({ value, scope: [scope, currentCtrl.token] }, () => undefined).then(input => {
          currentCtrl.defuse();
          if (currentCtrl === ctrl) {
            ctrl = undefined;
          }

          if (!latest) {
            emitting = false;
            return;
          }

          latest.resolve(input);

          defer(latest);
        }, cancel);
      };

      return await toFlow(src).each(
        ({ value, scope }) => {
          if (emitting) {
            latest?.resolve?.(undefined);
            ctrl?.cancel(new NewItemReceived(false)).catch(cancel);
            ctrl = undefined;

            return new Promise(resolve => {
              latest = { value, scope, resolve };
            });
          }

          emitting = true;

          _emit(value, scope);
          // emitScoped({ value, scope: [scope, ctrl] }, () => undefined).then(cancel);
        },
        { scope },
      );
    });

/**
 * Flattens a flow of flow-likes by switching to the latest inner flow and cancelling the previous one.
 * When a new inner flow-like is emitted, the previous inner flow is cancelled and values from the
 * new one are emitted instead.
 *
 * @example
 * ```ts
 * import { flowOf, defineFlow } from '@youngspe/async-flows';
 * import { switchLatest } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(
 *   defineFlow<number>(async ({ emit }) => { await emit(1); }),
 *   defineFlow<number>(async ({ emit }) => { await emit(2); }),
 * ).do(switchLatest());
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 2
 * ```
 */
export const switchLatest = <T, TReturn = undefined, TNext = void, UNext = void>(): FlowTransformer<
  Flow<ToFlow<T, TNext | undefined, UNext>, TReturn, TNext | undefined>,
  T,
  TReturn,
  UNext
> => compose(latest(), concatAll());

/**
 * Maps each value to a flow-like and switches to the latest inner flow, cancelling the previous one.
 * Equivalent to `map(fn)` followed by `switchLatest()`.
 *
 * @param fn - Function that maps each value to a flow-like
 *
 * @example
 * ```ts
 * import { flowOf } from '@youngspe/async-flows';
 * import { switchMap } from '@youngspe/async-flows/ops';
 *
 * const flow = flowOf(1, 2, 3).do(
 *   switchMap(n => [n, n * 2]),
 * );
 *
 * await flow.each(({ value }) => console.log(value));
 * // Output:
 * // 3
 * // 6
 * ```
 */
export const switchMap = <T, TReturn = undefined, TNext = void, U = T, UNext = void>(
  fn: (value: T) => ToFlow<U, TNext | undefined, UNext>,
): FlowTransformer<Flow<T, TReturn, TNext | undefined>, U, TReturn, UNext> =>
  compose(map(fn), switchLatest());
