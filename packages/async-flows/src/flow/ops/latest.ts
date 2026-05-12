import { Scope, Token } from '@youngspe/async-scope';
import { defineFlow, Flow, toFlow, type ToFlow } from '../../flow.ts';
import { compose, type FlowTransformer } from './module.ts';
import { concatAll, map } from './transform.ts';

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
 * const flow = flowOf(1, 2, 3).do(latest());
 *
 * await flow.each(({ value }) => console.log(value));
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
    defineFlow(async ({ emitScoped, scope }) => {
      const outerCtrl = scope.use(Token.createController());
      let emitPromise: Promise<TNext | undefined> | undefined;

      let latest: { value: T; scope: Scope } | undefined;

      return await toFlow(src).each(
        async ({ value, scope }) => {
          const out = await emitPromise;
          latest = { value, scope };
          emitPromise = Promise.resolve().then(() => {
            const _latest = latest;
            latest = undefined;
            if (!_latest) return undefined;
            return emitScoped(_latest);
          });
          emitPromise.catch(outerCtrl.cancel);
          return out;
        },
        { scope, token: outerCtrl },
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
 * ```
 */
export const switchMap = <T, TReturn = undefined, TNext = void, U = T, UNext = void>(
  fn: (value: T) => ToFlow<U, TNext | undefined, UNext>,
): FlowTransformer<Flow<T, TReturn, TNext | undefined>, U, TReturn, UNext> =>
  compose(map(fn), switchLatest());
