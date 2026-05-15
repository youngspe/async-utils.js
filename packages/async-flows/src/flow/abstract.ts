import {
  type CancellableOptions,
  CancellationError,
  Scope,
  type ScopeContext,
  type ToScope,
  Token,
  type TokenController,
  toErrorForCancellation,
  unwrapCancellationError,
} from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';
import { isPromiseLike, microtaskRepeat } from '@youngspe/common-async-utils';

import { ControlFlow, type AsyncControlFlow } from '#pkg/controlFlow';
import { toFlowAsync, type ToFlow } from '#pkg/flow';

import { Flow } from './flow.ts';

interface ContextWithFunction<T, TNext> {
  <V extends object = object>(
    this: void,
    options: CancellableOptions & { values: V },
  ): ScopeContext<FlowExecutorContext<T, TNext> & V>;
  <V extends object = object>(
    this: void,
    options: CancellableOptions & { values?: V | undefined },
  ): ScopeContext<FlowExecutorContext<T, TNext>, Partial<V>>;
}

export interface FlowExecutorContext<T, TNext> {
  cancel: (this: void, reason?: unknown) => void;
  abort: (this: void, reason?: unknown) => never;
  emit: <TCatch = never>(
    this: void,
    value: Awaitable<T>,
    onCancel?: ((error: Error) => Awaitable<TCatch>) | null,
  ) => Promise<TNext | TCatch>;
  emitScoped: <TCatch = never>(
    this: void,
    input: { value: Awaitable<T>; scope?: ToScope },
    onCancel?: ((error: Error) => Awaitable<TCatch>) | null,
  ) => Promise<TNext | TCatch>;
  emitAll: <TReturn, TCatch = never>(
    this: void,
    src: ToFlow<T, TReturn, TNext>,
    options?: CancellableOptions,
  ) => Promise<TReturn | TCatch>;
  contextWith: ContextWithFunction<T, TNext>;
}

export type FlowExecutor<T, TReturn, TNext> = (
  cx: ScopeContext<FlowExecutorContext<T, TNext>>,
) => Awaitable<TReturn>;

export class FlowError extends CancellationError {
  static {
    this.prototype.name = this.name;
  }
}

/**
 * If `true`, the given error value indicates a cancellation due to a flow-related event like
 * receiving a new item rather than a failure or explicit cancellation.
 */
export const isFlowError = (error: unknown): error is FlowError => error instanceof FlowError;

/**
 * If `true`, the given error value indicates a cancellation due to a flow-related event like
 * receiving a new item rather than a failure or explicit cancellation.
 * However, this returns `false` if the error indicates that a new item _will_ be received but
 * hasn't yet.
 */
export const isNonDeferredFlowError = (
  error: unknown,
): error is (FlowError | NewItemReceived) & { deferred?: false } =>
  error instanceof NewItemReceived ? !error.deferred : error instanceof FlowError;

export class NewItemReceived extends FlowError {
  static {
    this.prototype.name = this.name;
  }

  readonly deferred: boolean;

  constructor(deferred: boolean = false) {
    super();
    this.deferred = deferred;
  }
}

export class FlowComplete extends FlowError {
  static {
    this.prototype.name = this.name;
  }
}

export class FlowBreak extends FlowError {
  static {
    this.prototype.name = this.name;
  }
}

export abstract class AbstractFlow<T, TReturn, TNext> extends Flow<T, TReturn, TNext> {
  #scope;
  protected get _scope() {
    return this.#scope;
  }

  constructor(scope: Scope | undefined) {
    super();
    this.#scope = scope ?? Scope.static;
  }

  protected abstract _each(cx: ScopeContext<FlowExecutorContext<T, TNext>>): Awaitable<TReturn>;

  protected _onCancel?(error: Error): Awaitable<void>;
  protected _inScope?(scope: Scope): Flow<T, TReturn, TNext> | undefined;
  protected _buffer?(
    this: AbstractFlow<T, TReturn, undefined>,
    size: number,
    scope: Scope,
  ): Flow<T, TReturn, unknown> | undefined;
  #cancelled = false;

  #scopeContextValues<B>(
    handler: (cx: ScopeContext<{ value: T }>) => AsyncControlFlow<B, TNext>,
    innerScope: Scope,
    cancel: (reason?: unknown) => void,
    abort: (reason?: unknown) => never,
    state: { breakout: ControlFlow.Break<B> | undefined; handlerController?: TokenController | undefined },
  ): FlowExecutorContext<T, TNext> {
    const emitScoped = async <TCatch = never>(
      { value, scope: _providedScope }: { value: Awaitable<T>; scope?: ToScope },
      onCancel?: ((error: Error) => Awaitable<TCatch>) | null,
    ): Promise<TNext | TCatch> => {
      let _value: T;

      const providedScope = Scope.from(_providedScope);

      const oldCtrl = state.handlerController;
      const newCtrl = (state.handlerController = innerScope.use(
        providedScope.use(
          Token.createController({
            onAfterCancel: () => {
              if (state.handlerController === newCtrl) {
                state.handlerController = undefined;
              }
            },
          }),
        ),
      ));

      newCtrl.token.add(oldCtrl);

      if (isPromiseLike(value)) {
        // Set the `deferred` property of `NewItemReceived` based on whether the promise has resolved.
        let deferred = true;

        [_value] = await Promise.all([
          value,
          oldCtrl
            && value.then(
              // Once the promise is resolved, the new item is no longer deferred
              () => {
                deferred = false;
              },
            ),
          oldCtrl
            // Yield to the microtask flow once to give the promise a chance to resolve and set
            // `deferred` to false first:
            && new Promise<void>((resolve, reject) => {
              const mtRepeatCount = 8;
              microtaskRepeat(mtRepeatCount, i => {
                if (!deferred || i === mtRepeatCount) {
                  oldCtrl.cancel(new NewItemReceived(deferred)).then(resolve, reject);
                  return false;
                }
                return true;
              });
            }),
        ]);
      } else {
        _value = value;
        if (oldCtrl && !oldCtrl.token.error) {
          const p = oldCtrl.tryCancelSync(new NewItemReceived(false));
          if (p) {
            await p;
          }
        }
      }

      if (newCtrl.token.error) throw newCtrl.token.error;
      let out: ControlFlow<B, TNext>;

      try {
        out = await ControlFlow.fromAsync(
          handler(
            Scope.from([innerScope, providedScope, state.handlerController]).getContext({
              values: { value: _value },
            }),
          ),
        );
      } catch (error) {
        if (!newCtrl.token.isCancelled && !unwrapCancellationError(error)) {
          cancel(error);
        } else if (onCancel) {
          return onCancel(toErrorForCancellation(error));
        }

        throw error;
      }
      if ('continue' in out) return await out.continue;

      state.breakout = out;
      const error = new FlowBreak();
      cancel(error);
      throw error;
    };

    const emit = <TCatch = never>(
      value: Awaitable<T>,
      onCancel?: ((error: Error) => Awaitable<TCatch>) | null,
    ) => emitScoped({ value }, onCancel);

    const emitAll = async <TReturn, TCatch = never>(
      src: ToFlow<T, TReturn, TNext>,
      options?: CancellableOptions,
    ): Promise<TReturn | TCatch> => {
      let oldCtrl = state.handlerController;

      const newCtrl = innerScope.use(
        Token.createController({
          onAfterCancel: () => {
            if (state.handlerController === newCtrl) {
              state.handlerController = undefined;
            }
          },
        }),
      );

      newCtrl.token.add(oldCtrl);

      const scope = Scope.from([innerScope.replaceToken(newCtrl.token), options]);

      const innerFlow = await toFlowAsync(src);

      const out = await innerFlow.tryEach(
        ({ value, scope }): AsyncControlFlow<B, TNext> => {
          const p = oldCtrl?.tryCancelSync(new NewItemReceived());
          if (p) {
            return p.then<ControlFlow<Awaitable<B>, Awaitable<TNext>>>(() => {
              oldCtrl = undefined;

              const cx = scope.getContext({ values: { value }, token: newCtrl });
              return handler(cx);
            });
          }

          oldCtrl = undefined;
          const cx = scope.getContext({ values: { value }, token: newCtrl });
          return handler(cx);
        },
        { scope },
      );

      if (state.handlerController === newCtrl) {
        state.handlerController = oldCtrl;
      }

      if ('continue' in out) return out.continue;
      state.breakout = out;
      throw new FlowBreak();
    };

    const contextWith = (options => {
      const scope = Scope.from([innerScope, options]);
      const emitters = this.#scopeContextValues(handler, scope, cancel, abort, state);
      return scope.getContext({ values: Object.assign(emitters, options.values) });
    }) as ContextWithFunction<T, TNext>;

    return { emit, emitScoped, emitAll, contextWith, cancel, abort };
  }
  override tryEach<
    const F extends ControlFlow<Awaitable<B>, Awaitable<TNext>>,
    B = ControlFlow.BreakValue<F>,
  >(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<F | ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    let sub = undefined;
    if (this._onCancel) {
      sub = this.#scope.token.add(e => {
        if (this.#cancelled) return;
        this.#cancelled = true;
        return this._onCancel?.(e);
      });
    }
    const state: {
      breakout: ControlFlow.Break<B> | undefined;
      handlerController?: TokenController | undefined;
    } = { breakout: undefined };

    const promise: Promise<ControlFlow<B, TReturn>> = this.#scope
      .launch(async ({ scope, cancel, abort }) => {
        const controller = scope.use(Token.createController());
        const innerScope = scope.replaceToken(controller.token);

        const emitters = this.#scopeContextValues<B>(handler, innerScope, cancel, abort, state);

        const out = await this._each(innerScope.getContext({ values: emitters }));
        await controller.cancel(new FlowComplete());
        return out;
      }, options)
      .then(
        value => {
          if (state.breakout) return state.breakout;
          return { continue: value };
        },
        error => {
          if (state.breakout) return state.breakout;
          throw error;
        },
      );

    return sub ? promise.finally(() => sub.dispose()) : promise;
  }

  override inScope(scope: ToScope): Flow<T, TReturn, TNext> {
    if (!scope || scope === Scope.static || scope === this.#scope) return this;
    if (!this._inScope) return super.inScope(scope);

    const newScope = Scope.from([this.#scope, scope]);
    if (newScope === this.#scope) return this;

    return this._inScope?.(Scope.from([this.#scope, scope])) ?? super.inScope(scope);
  }

  override buffer(
    this: AbstractFlow<T, TReturn, undefined>,
    size: number,
    scope?: Scope,
  ): Flow<T, TReturn, unknown> {
    return this._buffer?.(size, Scope.from([this.#scope, scope])) ?? super.buffer(size, scope);
  }
}
