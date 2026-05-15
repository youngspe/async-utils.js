import type { ValueOrFunction } from '@youngspe/common-async-utils';

import type { CancellableLike, CancellableOptions } from '#pkg/cancel';
import { DefaultCancelStack, DefusedCancelStack, STATIC_TOKEN, Token, type CancelStack } from '#pkg/token';

import { Scope, STATIC_SCOPE, type ScopeContext, type ToScope } from './scope.ts';

/**
 * A wrapper around {@link CancelStack} that contains scope information.
 */
export abstract class ScopeStack<V extends object> {
  /** The underlying {@link CancelStack}. */
  abstract get cancelStack(): CancelStack;

  /**
   * A scope with the {@link Token.static|static} token used to populate scopes created by
   * this object.
   */
  protected abstract readonly _baseScope: Scope<V> | undefined;

  /**
   * Produces a scope that combines the base scope with the given `value`.
   * If `token` is provided, it will replace the returned scope's token.
   */
  protected _updateScope(value: ToScope, token?: Token): Scope<V> {
    let scope = this._baseScope;
    if (value && value !== STATIC_SCOPE && value !== STATIC_TOKEN) {
      scope = Scope.from(scope ? [scope, value] : value) as Scope<V>;
    }

    if (token) {
      scope = scope?.replaceToken(token) ?? (Scope.from<object>(token) as Scope<V>);
    }

    return scope ?? (STATIC_SCOPE as Scope<V>);
  }

  /**
   * Pushes a new sub-stack to the stack.
   * @returns the created stack.
   *
   * @see {@link CancelStack#pushStack()}
   */
  pushStack(options?: CancellableOptions): ScopeStack<V> {
    const ret = this.tryUse(({ scope }) => scope.createStack(options));

    if (ret) return ret;

    return options ?
        new DefaultScopeStack(this._updateScope(options).replaceToken(STATIC_TOKEN), this.cancelStack)
      : this;
  }

  /**
   * @see {@linkcode Scope#use()}
   * @see {@linkcode CancelStack#use()}
   * @see {@linkcode ScopeStack#tryUse()}
   */
  use<X>(
    value: ValueOrFunction<X & CancellableLike, [cx: ScopeContext<object, V>], X>,
    options?: CancellableOptions,
  ): X {
    if (typeof value !== 'function') return this.cancelStack.use(value, options);

    const { error } = this.cancelStack;
    if (error) throw error;

    const scope = options && Scope.from(options);

    return this.cancelStack.use(
      token => value(this._updateScope(scope, token).getContext()),
      scope && { scope },
    );
  }

  /**
   * @see {@linkcode Scope#tryUse()}
   * @see {@linkcode CancelStack#tryUse()}
   * @see {@linkcode ScopeStack#use()}
   */
  tryUse<X>(
    value: ValueOrFunction<X & CancellableLike, [cx: ScopeContext<object, V>], X>,
    options?: CancellableOptions,
  ): X | undefined {
    if (typeof value !== 'function') return this.cancelStack.tryUse(value, options);

    if (this.cancelStack.error) return undefined;

    const scope = options && Scope.from(options);

    return this.cancelStack.tryUse(
      token => value(this._updateScope(scope, token).getContext()),
      scope && { scope },
    );
  }

  /**
   * Pushes a {@link Token} to the stack.
   * @returns the created token.
   *
   * @see {@linkcode CancelStack#pushToken()}
   */
  pushToken(options?: CancellableOptions): Token {
    return this.cancelStack.pushToken(options);
  }

  /**
   * Pushes a {@link Scope} to the stack.
   * @returns the created scope.
   *
   * @see {@linkcode ScopeStack#pushToken()}
   */
  pushScope(options?: CancellableOptions): Scope<V> {
    return this._updateScope(undefined, this.pushToken(options));
  }
}

/** Standard implementation of {@link ScopeStack}. */
class DefaultScopeStack<V extends object> extends ScopeStack<V> {
  override readonly _baseScope;
  override readonly cancelStack;

  constructor(scope: Scope<V>, stack: CancelStack) {
    super();
    this._baseScope = scope;
    this.cancelStack = stack;
  }

  override pushStack(options?: CancellableOptions) {
    const stack = this.cancelStack.pushStack(options);
    return new DefaultScopeStack(this._baseScope, stack);
  }
}

/** A {@link ScopeStack} that is never closed. */
class DefusedScopeStack<V extends object> extends ScopeStack<V> {
  cancelStack = new DefusedCancelStack();
  override readonly _baseScope;

  constructor(scope: Scope<V>) {
    super();
    this._baseScope = scope === STATIC_SCOPE ? undefined : scope;
  }

  override pushStack(options?: CancellableOptions): ScopeStack<V> {
    return options ? (Scope.from<object>([this._baseScope, options]).createStack() as ScopeStack<V>) : this;
  }

  override _updateScope(scope: ToScope): Scope<V> {
    if (!scope) return this._baseScope ?? (STATIC_SCOPE as Scope<V>);
    if (!this._baseScope) return Scope.from(scope) as Scope<V>;
    return Scope.from<V>([this._baseScope, scope]);
  }
}

/** Creates a {@link ScopeStack} from the given {@link Scope}. */
export const createScopeStack = <V extends object>(scope: Scope<V>): ScopeStack<V> => {
  const { token } = scope;
  const tokenErasedScope = scope.replaceToken(Token.static);

  if (token.isDefused) return new DefusedScopeStack(tokenErasedScope);

  const stack = DefaultCancelStack.create(token ? Token.from([scope.token, token]) : scope.token);

  return new DefaultScopeStack(tokenErasedScope, stack);
};
