import { Scope, Token } from '@youngspe/async-scope';
import { defineFlow, Flow, toFlow, type ToFlow } from '../../flow.ts';
import { compose, type FlowTransformer } from './module.ts';
import { flat, map } from './transform.ts';

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

export const switchLatest = <T, TReturn = undefined, TNext = void, UNext = void>(): FlowTransformer<
  Flow<ToFlow<T, TNext | undefined, UNext>, TReturn, TNext | undefined>,
  T,
  TReturn,
  UNext
> => compose(latest(), flat());

export const switchMap = <T, TReturn = undefined, TNext = void, U = T, UNext = void>(
  fn: (value: T) => ToFlow<U, TNext | undefined, UNext>,
): FlowTransformer<Flow<T, TReturn, TNext | undefined>, U, TReturn, UNext> =>
  compose(map(fn), latest(), flat());
