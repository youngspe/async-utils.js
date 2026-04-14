import type { ScopeContext } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import type { ControlFlow } from '../../controlFlow.ts';
import { Flow, type FlowExecutorContext } from '../../flow.ts';
import { type FlowTransformer } from './module.ts';

export const tryTransformEach =
  <T, TReturn, TNext, U, UNext, B>(
    fn: (
      cx: ScopeContext<FlowExecutorContext<U, UNext> & { value: T }>,
    ) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, ControlFlow<B, TReturn>, UNext> =>
  src =>
    src.tryTransformEach(fn);

export const tryMap =
  <T, TReturn, TNext, U, B>(
    fn: (value: T) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<U>>>,
  ): FlowTransformer<Flow<T, TReturn, TNext>, U, ControlFlow<B, TReturn>, TNext> =>
  src =>
    src.tryTransformEach(async ({ value, emit }) => {
      const out = await fn(value);
      if (!('continue' in out)) return out;
      return { continue: emit(out.continue) };
    });
