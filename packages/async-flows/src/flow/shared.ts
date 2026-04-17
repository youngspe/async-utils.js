import {
  CancellationError,
  GenericEventEmitter,
  Scope,
  type CancellableOptions,
  type GenericEventController,
  type SubscriptionLifecycle,
} from '@youngspe/async-scope';

import { defineFlow, Flow } from '../flow.ts';
import type { Awaitable } from '@youngspe/async-scope-common';
import { isPromiseLike } from '@youngspe/common-async-utils';

type ItemEvent<T, TReturn> =
  | { status: 'yield'; value: T; scope: Scope | undefined }
  | { status: 'return'; value: TReturn }
  | { status: 'throw'; error: unknown };

const sharedFlowFromEvent = <T, TReturn>(
  emitter: GenericEventEmitter<ItemEvent<T, TReturn>, unknown>,
  scope?: Scope,
): Flow<T, TReturn, unknown> => {
  return defineFlow(
    ({ scope, emitScoped }) =>
      new Promise<TReturn>((resolve, reject) => {
        emitter.add(
          result => {
            switch (result.status) {
              case 'yield':
                return emitScoped({ value: result.value, scope: result.scope }).catch(reject);
              case 'return':
                return resolve(result.value);
              case 'throw':
                return reject(result.error);
            }
          },
          { scope },
        );
      }),
    { scope },
  );
};

export interface SharedFlowControllerLike<in T, in TReturn = undefined> {
  readonly emit: (this: void, value: Awaitable<T>, options?: CancellableOptions) => Promise<undefined>;
  readonly complete: (
    this: void,
    ...args: TReturn & undefined extends never ? [value: TReturn] : [value?: TReturn]
  ) => undefined;
  readonly fail: (this: void, error?: unknown) => undefined;
}

export interface SharedFlowController<
  in out T,
  in out TReturn = undefined,
> extends SharedFlowControllerLike<T, TReturn> {
  readonly flow: Flow<T, TReturn, unknown>;
}

class Controller<T, TReturn> implements SharedFlowController<T, TReturn> {
  #inner;
  readonly flow: Flow<T, TReturn, unknown>;

  constructor(
    inner: GenericEventController<ItemEvent<T, TReturn>, unknown, true>,
    scope: Scope | undefined,
  ) {
    this.#inner = inner;
    this.flow = sharedFlowFromEvent(inner.emitter, scope);
  }

  readonly emit = async (value: Awaitable<T>, options?: CancellableOptions) => {
    if (isPromiseLike(value)) {
      value = await value;
    }

    const scope = options && Scope.from(options);

    await this.#inner.emitAll({ status: 'yield', value, scope });
    return undefined;
  };

  readonly complete = (value?: TReturn) => void this.#inner.emitAll({ status: 'return', value: value! });

  readonly fail = (error: unknown = new CancellationError()) =>
    void this.#inner.emitAll({ status: 'throw', error });
}

interface SharedFlowControllerOptions<T, TReturn>
  extends
    CancellableOptions,
    SubscriptionLifecycle<
      [ctrl: SharedFlowController<T, TReturn>],
      [ctrl: SharedFlowController<T, TReturn>]
    > {}

export const sharedFlowController = <T, TReturn>(
  options?: SharedFlowControllerOptions<T, TReturn>,
): SharedFlowController<T, TReturn> => {
  const { init, dispose } = options ?? {};
  const scope = options && Scope.from(options);
  const ctrl = GenericEventEmitter.createController<
    ItemEvent<T, TReturn>,
    unknown,
    true,
    SharedFlowController<T, TReturn>
  >({
    isAsync: true,
    context: ctrl => new Controller(ctrl, scope),
    dispose,
    init:
      init
      && (({ context }) => {
        const { resume, ..._init } = init(context) ?? {};

        return { ..._init, resume: resume && (({ context }) => resume(context)) };
      }),
  });

  return ctrl.context;
};

export const sharedFlow = <T, TReturn>(options: SharedFlowControllerOptions<T, TReturn>) =>
  sharedFlowController(options).flow;
