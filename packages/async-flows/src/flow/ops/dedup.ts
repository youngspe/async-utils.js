import { Token, type Subscription, type TokenController } from '@youngspe/async-scope';
import { FlowError, isNonDeferredFlowError, NewItemReceived } from '../abstract.ts';
import { defineFlow } from '../util.ts';
import type { FlowInspector } from './module.ts';

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

export const dedup = <T, TReturn, TNext>(
  eq: (this: void, oldValue: T, newValue: T) => boolean = Object.is,
): FlowInspector<T, TReturn, TNext | undefined> => dedupByKey(x => x, eq);
