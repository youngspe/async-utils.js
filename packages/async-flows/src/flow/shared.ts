import {
  CancellationError,
  GenericEventEmitter,
  Scope,
  type CancellableOptions,
  type GenericEventController,
  type ScopeContext,
} from '@youngspe/async-scope';

import type { Awaitable } from '@youngspe/async-scope-common';
import { Deque, isPromiseLike } from '@youngspe/common-async-utils';

import { LifecycleCounter } from '#pkg/lifecycle/counter';

import { defineFlow } from './util.ts';
import { isNonDeferredFlowError } from './abstract.ts';
import type { Flow } from './flow.ts';

interface YieldEvent<T> {
  status: 'yield';
  value: Awaitable<T>;
  scope: Scope | undefined;
}

interface ReturnEvent<TReturn> {
  status: 'return';
  value: Awaitable<TReturn>;
}

interface ThrowEvent {
  status: 'throw';
  error: unknown;
}

type ItemEvent<T, TReturn> = YieldEvent<T> | ReturnEvent<TReturn> | ThrowEvent;

const sharedFlowFromEvent = <T, TReturn>(
  emitter: GenericEventEmitter<ItemEvent<T, TReturn>, unknown>,
  lifecycleCounter: LifecycleCounter | undefined,
  _replay: Deque<Awaitable<T>> | undefined,
  termRef: { value: ReturnEvent<TReturn> | ThrowEvent | undefined },
  scope?: Scope,
): Flow<T, TReturn, unknown> => {
  return defineFlow(
    async ({ scope, emit, emitScoped }) => {
      using _sub = lifecycleCounter?.add({ scope });
      const replay = _replay?.size ? _replay : undefined;
      const term = termRef.value;

      if (term?.status === 'throw') throw term.error;

      const items = replay && Array.from(replay);

      let replayPromise =
        items
        && (async () => {
          for (const item of items) {
            if (isPromiseLike(item)) {
              await item.then(emit, () => {});
            } else {
              await emit(item);
            }
          }
        })();

      if (term) {
        await replayPromise;
        return term.value;
      }

      const [out] = await Promise.all([
        new Promise<TReturn>((resolve, reject) => {
          emitter.add(
            async result => {
              try {
                if (replayPromise) {
                  await replayPromise;
                  replayPromise = undefined;
                }

                switch (result.status) {
                  case 'yield':
                    return await emitScoped(result);
                  case 'return':
                    return resolve(result.value);
                  case 'throw':
                    return reject(result.error);
                }
              } catch (error) {
                reject(error);
              }
            },
            { scope },
          );
        }),
        replayPromise,
      ]);

      return out;
    },
    { scope },
  );
};

export interface SharedFlowControllerLike<in T, in TReturn = undefined> {
  readonly emit: (this: void, value: Awaitable<T>, options?: CancellableOptions) => Promise<undefined>;
  readonly complete: (
    this: void,
    ...args: TReturn & undefined extends never ? [value: Awaitable<TReturn>] : [value?: Awaitable<TReturn>]
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
  #inner: GenericEventController<ItemEvent<T, TReturn>, unknown, true> | undefined;
  #closeOnTerminate;
  readonly flow: Flow<T, TReturn, unknown>;

  constructor(
    inner: GenericEventController<ItemEvent<T, TReturn>, unknown, true>,
    lifecycleCounter: LifecycleCounter | undefined,
    replayQueue: Deque<Awaitable<T>> | undefined,
    termRef: { value: ReturnEvent<TReturn> | ThrowEvent | undefined },
    closeOnTerminate: boolean,
    scope: Scope | undefined,
  ) {
    this.#inner = inner;
    this.#closeOnTerminate = closeOnTerminate;
    this.flow = sharedFlowFromEvent(inner.emitter, lifecycleCounter, replayQueue, termRef, scope);
  }

  readonly emit = async (value: Awaitable<T>, options?: CancellableOptions): Promise<undefined> => {
    if (isPromiseLike(value)) {
      value = await value;
    }

    let scope = undefined;

    if (options) {
      scope = Scope.from(options);
      const token = scope.token.filter(e => !isNonDeferredFlowError(e));
      scope = scope.replaceToken(token);
    }

    await this.#inner?.emitAll({ status: 'yield', value, scope });
  };

  readonly complete = (value?: Awaitable<TReturn>): undefined => {
    void this.#inner?.emitAll({ status: 'return', value: value! });
    if (this.#closeOnTerminate) {
      this.#inner = undefined;
    }
  };

  readonly fail = (error: unknown = new CancellationError()): undefined => {
    void this.#inner?.emitAll({ status: 'throw', error });

    if (this.#closeOnTerminate) {
      this.#inner = undefined;
    }
  };
}

export interface SharedFlowOptions extends CancellableOptions {
  replay?: boolean | number | undefined;
  sharing?: 'eager' | 'lazy' | 'whenObserved' | undefined;
}

interface SharedFlowControllerOptions<T, TReturn> extends SharedFlowOptions {
  onInit?:
    | ((
        cx: ScopeContext<
          SharedFlowController<T, TReturn> & { controller: SharedFlowController<T, TReturn> }
        >,
      ) => Awaitable<void>)
    | undefined;
  onStart?:
    | ((
        cx: ScopeContext<
          SharedFlowController<T, TReturn> & { controller: SharedFlowController<T, TReturn> }
        >,
      ) => Awaitable<void>)
    | undefined;
  onResume?:
    | ((
        cx: ScopeContext<
          SharedFlowController<T, TReturn> & { controller: SharedFlowController<T, TReturn> }
        >,
      ) => Awaitable<void>)
    | undefined;
}

export const sharedFlowController = <T, TReturn>(
  options?: SharedFlowControllerOptions<T, TReturn>,
): SharedFlowController<T, TReturn> => {
  const { onInit, onStart, onResume, replay = false, sharing = 'whenObserved' } = options ?? {};
  const scope = options && Scope.from(options);
  const replayQueue = replay ? new Deque<Awaitable<T>>() : undefined;

  const termRef: { value: ReturnEvent<TReturn> | ThrowEvent | undefined } = { value: undefined };

  const onItem = (item: ItemEvent<T, TReturn>) => {
    if (item.status === 'yield') {
      if (replayQueue) {
        if (typeof replay === 'number' && replayQueue.size >= replay) {
          void replayQueue.shift();
        }

        replayQueue.push(item.value);
      }

      return;
    }

    termRef.value = item;

    if (item.status === 'throw') {
      replayQueue?.clear();
    }
  };

  let lifecycleCounter: LifecycleCounter | undefined;

  if (replay || onInit || onStart) {
    lifecycleCounter = new LifecycleCounter({
      scope,
      createWhen: sharing === 'eager' ? 'immediately' : 'firstAdded',
      stopWhen: sharing === 'whenObserved' ? 'lastRemoved' : 'never',
    });
  }

  const { context: ctrl, emitter } = GenericEventEmitter.createController<
    ItemEvent<T, TReturn>,
    unknown,
    true,
    SharedFlowController<T, TReturn>
  >({
    isAsync: true,
    context: ctrl =>
      new Controller(ctrl, lifecycleCounter, replayQueue, termRef, sharing !== 'whenObserved', scope),
  });

  lifecycleCounter?.lifecycle
    .in({
      created:
        onInit && (({ scope }) => onInit(scope.getContext({ values: { ...ctrl, controller: ctrl } }))),
      started: ({ scope }) => {
        scope.use(emitter.add(onItem));
        if (replayQueue) {
          scope.token.add(() => {
            replayQueue.clear();
          });
        }
        return onStart?.(scope.getContext({ values: { ...ctrl, controller: ctrl } }));
      },
      resumed:
        onResume && (({ scope }) => onResume(scope.getContext({ values: { ...ctrl, controller: ctrl } }))),
    })
    .catch(() => undefined)
    .catch(ctrl.fail);

  return ctrl;
};

export const sharedFlow = <T, TReturn>(options: SharedFlowControllerOptions<T, TReturn>) =>
  sharedFlowController(options).flow;
