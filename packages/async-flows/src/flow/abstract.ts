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
import { isPromiseLike } from '@youngspe/common-async-utils';

import { ControlFlow } from '../controlFlow.ts';
import { Flow, toFlowAsync, type ToFlow } from '../flow.ts';

export interface FlowExecutorContext<T, TNext> {
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
}

export type FlowExecutor<T, TReturn, TNext> = (
  cx: ScopeContext<FlowExecutorContext<T, TNext>>,
) => Promise<TReturn>;

export class FlowError extends CancellationError {
  static {
    this.prototype.name = this.name;
  }
}

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

  constructor(scope: Scope) {
    super();
    this.#scope = scope;
  }

  protected abstract _each(cx: ScopeContext<FlowExecutorContext<T, TNext>>): Awaitable<TReturn>;

  protected _onCancel?(error: Error): Awaitable<void>;
  protected _inScope?(scope: Scope): Flow<T, TReturn, TNext> | undefined;
  #cancelled = false;

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
    const promise: Promise<ControlFlow<B, TReturn>> = this.#scope.launch(
      ({ scope }) =>
        new Promise((resolve, reject) => {
          const controller = Token.createController();
          const innerScope = Scope.from([scope, controller]);
          let breakout: ControlFlow.Break<B> | undefined;

          let handlerController: TokenController | undefined;

          const emitScoped = async <TCatch = never>(
            { value, scope: _providedScope }: { value: Awaitable<T>; scope?: ToScope },
            onCancel?: ((error: Error) => Awaitable<TCatch>) | null,
          ): Promise<TNext | TCatch> => {
            let _value: T;

            const providedScope = Scope.from(_providedScope);

            const oldCtrl = handlerController;
            const newCtrl = (handlerController = innerScope.use(
              providedScope.use(Token.createController()),
            ));

            handlerController.token.add(oldCtrl);

            if (isPromiseLike(value)) {
              [_value] = await Promise.all([value, oldCtrl?.cancel(new NewItemReceived(true))]);
            } else {
              _value = value;
              await oldCtrl?.cancel(new NewItemReceived(false));
            }

            if (newCtrl.token.error) throw newCtrl.token.error;
            let out;

            try {
              out = await ControlFlow.fromAsync(
                handler(
                  Scope.from([innerScope, providedScope, handlerController]).getContext({
                    values: { value: _value },
                  }),
                ),
              );
            } catch (error) {
              if (!newCtrl.token.isCancelled && !unwrapCancellationError(error)) {
                controller.cancel(error).catch(reject);
              } else if (onCancel) {
                return onCancel(toErrorForCancellation(error));
              }

              throw error;
            }
            if ('continue' in out) return await out.continue;

            breakout = out;
            const error = new FlowBreak();
            controller.cancel(error).catch(reject);
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
            const innerFlow = await toFlowAsync(src);

            const out = await innerFlow.tryEach(
              handler,
              options ? { ...options, scope: [innerScope, options.scope] } : { scope: innerScope },
            );

            if ('continue' in out) return out.continue;
            breakout = out;
            throw new FlowBreak();
          };

          (async () => {
            try {
              const out = await this._each(
                innerScope.getContext({ values: { emit, emitScoped, emitAll } }),
              );
              await controller.cancel(new FlowComplete());
              if (breakout) return breakout;
              return { continue: out };
            } catch (error) {
              await controller.cancel(error);
              if (breakout) return breakout;
              throw error;
            }
          })().then(resolve, reject);
        }),
      options,
    );

    return sub ? promise.finally(() => sub.dispose()) : promise;
  }

  override inScope(scope: ToScope) {
    return this._inScope?.(Scope.from([this.#scope, scope])) ?? super.inScope(scope);
  }
}
