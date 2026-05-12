import {
  type CancellableLike,
  type CancellableOrDisposable,
  type CancellationListener,
} from '../cancel.ts';
import { Subscription } from '../events.ts';
import { Token, type AddCancellableOptions } from '../token.ts';
import { SafeCancellable } from '../safeCancellable.ts';

/** Represents the current state of an {@link AggregateToken} */
export type AggregateTokenState =
  | { kind: 'tokens'; tokens: Set<Token> }
  | { kind: 'defused' }
  | { kind: 'cancelled'; error: Error; token: Token | undefined };

/** A {@link Token} that is cancelled when any of a set of tokens are cancelled. */
export class AggregateToken extends Token {
  #tokens: Set<Token> | undefined = new Set();

  constructor(tokens: Set<Token>) {
    super();
    this.#tokens = tokens;
  }

  /**
   * The error for the first cancelled child token.
   *
   * If this is set, `#tokens` should be unset.
   */
  #error: Error | undefined;
  /**
   * The first child token to be cancelled.
   *
   * If this is set, `#error` should be set and `#tokens` should be unset.
   */
  #cancelledToken: Token | undefined;

  /**
   * Set to `true` only when `#getError` is running so the method can exit early if
   * called recursively.
   * This makes `#getError` safely reentrant.
   */
  #gettingError = false;

  /**
   * Checks all child tokens for errors and returns the first error found, if any.
   *
   * If an error is found, the child token set is removed so no new cancellables can be added.
   */
  #getError() {
    const tokens = this.#tokens;
    if (!tokens) return;

    if (this.#gettingError) return undefined;
    this.#gettingError = true;

    try {
      for (const token of tokens) {
        const { error } = token;
        if (error) {
          this.#error = error;
          tokens.clear();
          this.#tokens = undefined;
          return error;
        }
      }
    } finally {
      this.#gettingError = false;
    }
  }

  override get error() {
    return this.#error ?? this.#getError();
  }

  /**
   * Set to `true` only when `get isDefused()` is running so the method can exit early if
   * called recursively.
   * This makes `get isDefused()` safely reentrant.
   */
  #gettingIsDefused = false;

  override get isDefused() {
    if (this.#error) return false;
    const tokens = this.#tokens;
    if (!tokens) return true;

    if (this.#gettingIsDefused) return true;
    this.#gettingIsDefused = true;

    try {
      for (const token of tokens) {
        if (!token.isDefused) return false;

        tokens.delete(token);
      }

      this.#tokens = undefined;
      return true;
    } finally {
      this.#gettingIsDefused = false;
    }
  }

  protected override _add(
    listener: CancellableOrDisposable,
    options: AddCancellableOptions = {},
  ): Subscription | undefined {
    return this.add(listener, options);
  }

  override add(
    listener: CancellableLike<CancellationListener>,
    options: AddCancellableOptions = {},
  ): Subscription | undefined {
    if (this.#cancelledToken) return this.#cancelledToken.add(listener, options);
    if (this.#error) return undefined;

    const tokens = this.#tokens;
    if (!tokens?.size) return Subscription.noop;

    listener = SafeCancellable.from(listener);

    const subs: Subscription[] = [];

    for (const token of tokens) {
      const newSub = token.add(listener, options);
      if (!newSub) {
        const { error } = token;

        if (error) {
          this.#error = error;
          this.#cancelledToken = token;
          tokens.clear();
          this.#tokens = undefined;

          for (const sub of subs) {
            sub.dispose();
          }

          return undefined;
        }
        continue;
      }

      if (!newSub.isActive) {
        if (token.isDefused) {
          newSub.dispose();
          tokens.delete(token);
          continue;
        }
      }

      subs.push(newSub);
    }

    if (tokens.size === 0) {
      this.#tokens = undefined;
    }

    return Subscription.collect(subs);
  }

  protected override _simplify(): Token {
    if (this.#error) return this.#cancelledToken ?? Token.cancelled(this.#error);
    // Getting `isDefused` here forces simplification of the token set
    if (this.isDefused) return Token.static;

    if (this.#tokens?.size === 1) {
      const [token] = this.#tokens;
      return token!;
    }

    return this;
  }

  /**
   * Extract the current state from the given token.
   * If the token is still active, the returned object includes all tokens it contains.
   */
  static expand(this: void, target: AggregateToken): AggregateTokenState {
    if (target.#error) {
      return { kind: 'cancelled', error: target.#error, token: target.#cancelledToken };
    }

    const tokens = target.#tokens;
    if (!tokens) return { kind: 'defused' };

    for (const token of tokens) {
      const { error } = token;
      if (error) {
        target.#error = error;
        target.#cancelledToken = token;
        tokens.clear();
        target.#tokens = undefined;
        return { kind: 'cancelled', error, token };
      }

      if (token.isDefused) {
        tokens.delete(token);
      }
    }

    if (tokens?.size) {
      return { kind: 'tokens', tokens };
    }

    target.#tokens = undefined;
    return { kind: 'defused' };
  }
}

/**
 * If the given token is an aggregate token, adds all active child tokens to the given set if or
 * returns the first cancelled token.
 * If the given token is cancelled, returns it.
 * If the given token is not defused, adds it to the set.
 */
export function expandTokenToSet(src: Token, dst: Set<Token>): Token | undefined {
  if (src instanceof AggregateToken) {
    const state = AggregateToken.expand(src);

    switch (state.kind) {
      case 'cancelled': {
        return state.token ?? src;
      }
      case 'defused': {
        break;
      }
      case 'tokens': {
        for (const token of state.tokens) {
          dst.add(token);
        }
        break;
      }
    }

    return;
  }

  if (src.isCancelled) return src;
  if (src.isDefused) return;

  dst.add(src);
}

/**
 * Combines the given set of tokens into one {@link Token}, or `undefined` if the set is empty.
 */
export function combineTokenSet(tokens: Set<Token>): Token | undefined {
  if (tokens.size > 1) return new AggregateToken(tokens);
  const [token] = tokens;
  return token;
}
