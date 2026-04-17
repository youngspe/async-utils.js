import type { Awaitable } from '@youngspe/async-scope-common';
import type { ScopeContext } from '@youngspe/async-scope';

import { defineFlow } from '../../flow.ts';
import { ident, type FlowInspector } from '../ops.ts';
import type { Falsy } from '../../types.ts';

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

export const inspectError = <T, TReturn, TNext>(
  onError?: ((error: unknown) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> => inspectComplete(undefined, onError);

export const inspectErrorScoped = <T, TReturn, TNext>(
  onError?: ((cx: ScopeContext<{ error: unknown }>) => Awaitable<void>) | Falsy,
): FlowInspector<T, TReturn, TNext> => inspectCompleteScoped(undefined, onError);

export const inspectFinally = <T, TReturn, TNext>(
  onFinally?:
    | ((
        cx:
          | ScopeContext<{ value: TReturn; error?: unknown }>
          | ScopeContext<{ value?: never; error: unknown }>,
      ) => Awaitable<void>)
    | Falsy,
): FlowInspector<T, TReturn, TNext> => inspectCompleteScoped<T, TReturn, TNext>(onFinally, onFinally);

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
