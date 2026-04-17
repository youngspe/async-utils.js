import {
  Scope,
  toErrorForCancellation,
  type CancellableOptions,
  type GenericEventEmitter,
  type ScopeContext,
} from '@youngspe/async-scope';
import { AbstractFlow, type FlowExecutorContext } from './abstract.ts';
import type { Flow } from '../flow.ts';

export class SyncEventFlow<T> extends AbstractFlow<T, undefined, unknown> {
  #emitter;

  constructor(emitter: GenericEventEmitter<T, undefined>, scope: Scope) {
    super(scope);
    this.#emitter = emitter;
  }

  override _each({ emit, scope }: ScopeContext<FlowExecutorContext<T, unknown>>) {
    return new Promise<undefined>((resolve, reject) => {
      let queue: T[] | undefined;
      let done = false;

      this.#emitter.add(
        value => {
          if (queue) {
            queue.push(value);
            return;
          }

          queue = [value];

          (async () => {
            try {
              while (queue?.length) {
                const value = queue.shift()!;
                await emit(value);
              }

              if (done) {
                resolve(undefined);
              }
            } finally {
              queue = undefined;
            }
          })().catch(reject);
        },
        {
          scope,
          onRemove: () => {
            done = true;
            if (!queue) {
              resolve(undefined);
            }
          },
        },
      );
    });
  }

  override _inScope(scope: Scope) {
    return new SyncEventFlow(this.#emitter, scope);
  }
}

export class AsyncEventFlow<T, TNext = undefined> extends AbstractFlow<T, undefined, TNext | undefined> {
  #emitter;

  constructor(emitter: GenericEventEmitter<T, Promise<TNext | undefined>>, scope: Scope) {
    super(scope);
    this.#emitter = emitter;
  }

  override _each({ emit, scope }: ScopeContext<FlowExecutorContext<T, TNext>>) {
    return new Promise<undefined>((outerResolve, outerReject) => {
      let queue: Array<{ value: T; resolve: (value: TNext | undefined) => void }> | undefined;
      let emitterDisconnected = false;
      let cancellation: Error | undefined = undefined;

      this.#emitter.add(
        value =>
          new Promise(resolve => {
            if (cancellation) return resolve(undefined);

            if (queue) {
              queue.push({ value, resolve });
              return;
            }

            queue = [{ value, resolve }];

            (async () => {
              try {
                let item;

                while ((item = queue?.shift())) {
                  const { value, resolve } = item;

                  if (cancellation) {
                    resolve(undefined);
                    continue;
                  }

                  cancellation = await emit(value).then(
                    x => (resolve(x), undefined),
                    e => (resolve(undefined), toErrorForCancellation(e)),
                  );
                }
              } finally {
                if (cancellation) {
                  outerReject(cancellation);
                } else if (emitterDisconnected) {
                  outerResolve(undefined);
                }
                queue = undefined;
              }
            })().catch(outerReject);
          }),
        {
          scope,
          onRemove: () => {
            emitterDisconnected = true;
            if (!queue) {
              outerResolve(undefined);
            }
          },
        },
      );
    });
  }

  override _inScope(scope: Scope) {
    return new AsyncEventFlow(this.#emitter, scope);
  }
}

export const flowFromEvent = <T>(
  emitter: GenericEventEmitter<T, undefined>,
  options?: CancellableOptions,
): Flow<T, undefined, unknown> => new SyncEventFlow(emitter, Scope.from(options));

export function flowFromAsyncEvent<T>(
  emitter: GenericEventEmitter<T, Promise<void>>,
  options?: CancellableOptions,
): Flow<T, undefined, unknown>;
export function flowFromAsyncEvent<T, TNext>(
  emitter: GenericEventEmitter<T, Promise<TNext | undefined>>,
  options?: CancellableOptions,
): Flow<T, undefined, TNext>;
export function flowFromAsyncEvent<T, TNext>(
  emitter: GenericEventEmitter<T, Promise<TNext | undefined>>,
  options?: CancellableOptions,
): Flow<T, undefined, TNext> {
  return new AsyncEventFlow(emitter, Scope.from(options));
}
