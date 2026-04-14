import { Token } from '../token.ts';
import { Scope, STATIC_SCOPE, type ToScope, StandardScope } from '../scope.ts';
import { ScopedResources } from '../scopedResource.ts';
import { isIterable } from '@youngspe/common-async-utils';
import { ContextData } from './context.ts';
import { CancellationTokenBase, ScopeBase } from '@youngspe/async-scope-common';

function combineContextData(values: IterableIterator<ContextData>): ContextData | undefined {
  const firstResult = values.next();
  if (firstResult.done) return undefined;
  const first = firstResult.value;

  let builder;

  for (const item of values) {
    builder ??= first.builder();
    builder.merge(item);
  }

  return builder?.finish() ?? first;
}

export function scopeFrom<V extends object = object>(
  src: ToScope<V>,
  onError?: (error: unknown) => void,
): Scope<V> {
  if (!src) return STATIC_SCOPE as Scope<V>;
  if (src instanceof ScopeBase) return src;
  if (src instanceof CancellationTokenBase) return new StandardScope({ token: src, onError });
  if (src instanceof AbortSignal) {
    return new StandardScope({ token: Token.fromAbortSignal(src, { onError }), onError });
  }

  let hasNonScopeToken = false;
  const scopes = new Set<Scope<Partial<V>>>();
  const tokens = new Set<Token>();
  const abortSignals = new Set<AbortSignal>();
  const resources = new Set<ScopedResources>();
  const contextData = new Set<ContextData>();

  function flatten(src: ToScope, includeScope: boolean): Token | undefined {
    if (!src || typeof src !== 'object') return;

    if (src instanceof Scope && includeScope) {
      if (src.token.isCancelled) return src.token;
      if (src === STATIC_SCOPE) return;
      scopes.add(src);

      if (!src.token.isDefused) {
        tokens.add(src.token);
      }

      if (!src.resources.isEmpty) {
        resources.add(src.resources);
      }

      if (src.contextData !== ContextData.empty) {
        contextData.add(src.contextData);
      }

      return;
    }

    if (src instanceof Token) {
      hasNonScopeToken = true;
      if (src.isCancelled) return src;
      if (!src.isDefused) {
        tokens.add(src);
      }
      return;
    }

    if (src instanceof AbortSignal) {
      hasNonScopeToken = true;
      if (src.aborted) return Token.cancelled(src.reason);

      abortSignals.add(src);
      return;
    }

    if (isIterable(src)) {
      for (const child of src) {
        const cancelled = flatten(child, includeScope);
        if (cancelled) return cancelled;
      }
      return;
    }

    return flatten(src.scope, true) || flatten(src.token, false) || flatten(src.signal, false);
  }

  const cancelled = flatten(src, true);

  if (!hasNonScopeToken && scopes.size <= 1) {
    // If only one scope was passed in with no other tokens, we can return the
    // scope directly.
    //
    // If there are zero scopes and tokens, we can return the static scope
    //
    const [scope] = scopes;

    if (!cancelled || scope?.token === cancelled) return (scope ?? STATIC_SCOPE) as Scope<V>;
  }

  if (cancelled) return new StandardScope({ token: cancelled });

  let [signal] = abortSignals;

  if (abortSignals.size > 1) {
    signal = AbortSignal.any(Array.from(abortSignals));
  }

  if (signal) {
    tokens.add(Token.fromAbortSignal(signal));
  }

  return new StandardScope({
    token: Token.combine(tokens),
    resources: ScopedResources.combine(resources),
    contextData: combineContextData(contextData.values()) as ContextData<V>,
    onError,
  });
}
