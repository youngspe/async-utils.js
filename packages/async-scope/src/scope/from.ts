import { Token } from '../token.js';
import { Scope, STATIC_SCOPE, type ToScope } from '../scope.js';
import { isArray, TODO } from '../utils.ts';
import { StandardScope } from './standard.ts';

export function scopeFrom(src: ToScope): Scope {
  if (!src) return STATIC_SCOPE;
  if (src instanceof Scope) return src;
  if (src instanceof Token) return new StandardScope(src);
  if (src instanceof AbortSignal) return new StandardScope(TODO('Token from AbortSignal'));

  let hasNonScopeBoundSource = false;
  const scopes = new Set<Scope>();
  const tokens = new Set<Token>();
  const abortSignals = new Set<AbortSignal>();

  function flatten(src: ToScope): Token | undefined {
    if (!src) return;

    if (src instanceof Scope) {
      if (src.token.isCancelled) return src.token;
      scopes.add(src);

      if (!src.token.isDefused) {
        tokens.add(src.token);
      }

      return;
    }

    if (src instanceof Token) {
      hasNonScopeBoundSource = true;
      if (src.isCancelled) return src;
      if (!src.isDefused) {
        tokens.add(src);
      }
      return;
    }

    if (src instanceof AbortSignal) {
      hasNonScopeBoundSource = true;
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

    return flatten(src.scope ?? src.signal);
  }

  const cancelled = flatten(src);

  if (!hasNonScopeBoundSource && scopes.size <= 1) {
    // If only one scope was passed in with no other tokens, we can return the
    // scope directly.
    //
    // If there are zero scopes and tokens, we can return the static scope
    //
    const [scope] = scopes;

    if (!cancelled || scope?.token === cancelled) return scope ?? TODO('static/forever scope');
  }

  if (cancelled) return new StandardScope(cancelled);

  let [signal] = abortSignals;

  if (abortSignals.size > 1) {
    signal = AbortSignal.any(Array.from(abortSignals));
  }

  if (signal) {
    tokens.add(TODO('Token from AbortSignal'));
  }

  return new StandardScope(Token.combine(tokens));
}
