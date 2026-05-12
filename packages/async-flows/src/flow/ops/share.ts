import type { FlowTransformer } from './module.ts';
import { sharedFlow, type SharedFlowOptions } from '#pkg/flow/shared';
import type { Flow } from '#pkg/flow/flow';

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
