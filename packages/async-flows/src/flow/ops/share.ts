import { Scope, Token, type CancellableOptions } from '@youngspe/async-scope';
import type { FlowTransformer } from '../ops.ts';
import { Flow, sharedFlow } from '../../flow.ts';

export const share =
  <T, TReturn>(
    options: CancellableOptions,
  ): FlowTransformer<Flow<T, TReturn, undefined>, T, TReturn, unknown> =>
  src => {
    const scope = Scope.from(options);
    return sharedFlow({
      scope,
      init: () => ({
        resume: ({ emit, complete, fail }) => {
          const ctrl = scope.use(Token.createController());

          scope
            .replaceToken(ctrl.token)
            .launch(({ scope }) => src.each(({ value, scope }) => emit(value, scope), { scope }))
            .then(complete, fail);

          return {
            pause: () => {
              ctrl.cancel().catch(fail);
            },
          };
        },
      }),
    });
  };
