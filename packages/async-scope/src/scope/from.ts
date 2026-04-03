import { Token } from '../token.ts';
import { Scope, STATIC_SCOPE, type ToScope, StandardScope } from '../scope.ts';
import { isArray, TODO } from '../utils.ts';
import { ScopedResources } from '../scopedResource.ts';

export function scopeFrom(src: ToScope, onError?: (error: unknown) => void): Scope {
  if (!src) return STATIC_SCOPE;
  if (src instanceof Scope) return src;
  if (src instanceof Token) return new StandardScope({ token: src, onError });
  if (src instanceof AbortSignal) {
    return new StandardScope({ token: Token.fromAbortSignal(src, { onError }), onError });
  }

  let hasNonScopeToken = false;
  const scopes = new Set<Scope>();
  const tokens = new Set<Token>();
  const abortSignals = new Set<AbortSignal>();
  const resources = new Set<ScopedResources>();

  function flatten(src: ToScope): Token | undefined {
    if (!src) return;

    if (src instanceof Scope) {
      if (src.token.isCancelled) return src.token;
      scopes.add(src);

      if (!src.token.isDefused) {
        tokens.add(src.token);
      }

      if (!src.resources.isEmpty) {
        resources.add(src.resources);
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
      if (src.aborted) return TODO('pre-cancelled Token');

      abortSignals.add(src);
      return;
    }

    if (isArray(src) || src instanceof Set) {
      for (const child of src) {
        const cancelled = flatten(child);
        if (cancelled) return cancelled;
      }
      return;
    }

    return flatten(src.scope) || flatten(src.token) || flatten(src.signal);
  }

  const cancelled = flatten(src);

  if (!hasNonScopeToken && scopes.size <= 1) {
    // If only one scope was passed in with no other tokens, we can return the
    // scope directly.
    //
    // If there are zero scopes and tokens, we can return the static scope
    //
    const [scope] = scopes;

    if (!cancelled || scope?.token === cancelled) return scope ?? Scope.static;
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
    onError,
  });
}
