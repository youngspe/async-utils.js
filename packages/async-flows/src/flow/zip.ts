import {
  defineFlow,
  Flow,
  FlowComplete,
  NewItemReceived,
  toFlow,
  type FlowItemOf,
  type ToFlow,
} from '../flow.ts';
import { isIterable, joinPromises, whenAllSettled } from '@youngspe/common-async-utils';
import { map } from './ops/transform.ts';
import { Scope, Token } from '@youngspe/async-scope';

export function zipFlows<
  const A extends readonly ToFlow<unknown, TReturn, TNext>[],
  TReturn = undefined,
  TNext = void,
>(flows: A): Flow<{ [K in keyof A]: FlowItemOf<A[K]> }, TReturn, TNext>;
export function zipFlows<T, TReturn, TNext>(
  flows: Iterable<ToFlow<T, TReturn, TNext>>,
): Flow<T[], TReturn, TNext>;
export function zipFlows<
  const A extends { [k: PropertyKey]: ToFlow<unknown, TReturn, TNext> },
  TReturn = undefined,
  TNext = void,
>(flows: A): Flow<{ [K in keyof A]: FlowItemOf<A[K]> }, TReturn, TNext>;
export function zipFlows<T, TReturn, TNext>(
  flows: Iterable<ToFlow<T, TReturn, TNext>> | Record<PropertyKey, ToFlow<T, TReturn, TNext>>,
): Flow<T[] | Record<PropertyKey, T>, TReturn, TNext> {
  if (!isIterable(flows)) {
    const keys = Object.keys(flows);
    const _flows = Object.values(flows);

    const flow = zipFlows(_flows);

    return flow.do(
      map(values => {
        const out: Record<PropertyKey, T> = {};

        values.forEach((x, i) => {
          out[keys[i]!] = x;
        });

        return out;
      }),
    );
  }

  const _flows = Array.from(flows, toFlow);

  const allRepeatable = _flows.every(f => f.repeatable);

  const out: Flow<T[], TReturn, TNext> = defineFlow(async ({ scope, emitScoped }) => {
    const iters = Array.from(_flows, f => toFlow(f).iter({ scope }));

    let next: [TNext] | [] = [];

    while (true) {
      const items: T[] = [];
      const scopes: Scope[] = [];
      const out = await joinPromises(
        iters,
        (it, i): Promise<IteratorResult<{ value: T; scope: Scope }, TReturn>> => {
          const p = it.next(...next);
          const fl = _flows[i];
          if (allRepeatable || !fl?.repeatable) return p;

          return p.then(r => {
            if (!r.done) return r;
            it = iters[i] = fl.iter({ scope });
            return it.next();
          });
        },
        (result: IteratorResult<{ value: T; scope: Scope }, TReturn>, i) => {
          if (result.done) return result;

          items[i] = result.value.value;
          scopes[i] = result.value.scope;
        },
      );

      if (out) return out.value;

      next = [await emitScoped({ value: items, scope: scopes })];
    }
  });

  return allRepeatable ? Object.assign(out, { repeatable: true }) : out;
}

export function combineLatest<
  const A extends readonly ToFlow<unknown, TReturn, TNext>[],
  TReturn = undefined,
  TNext = unknown,
>(flows: A): Flow<{ [K in keyof A]: FlowItemOf<A[K]> }, TReturn, TNext>;
export function combineLatest<T, TReturn = undefined, TNext = unknown>(
  flows: Iterable<ToFlow<T, TReturn, TNext>>,
): Flow<T[], TReturn, unknown>;
export function combineLatest<
  const A extends { [k: PropertyKey]: ToFlow<unknown, TReturn, TNext> },
  TReturn = undefined,
  TNext = unknown,
>(flows: A): Flow<{ [K in keyof A]: FlowItemOf<A[K]> }, TReturn, TNext>;
export function combineLatest<T, TReturn, TNext>(
  flows: Iterable<ToFlow<T, TReturn, TNext>> | Record<PropertyKey, ToFlow<T, TReturn, TNext>>,
): Flow<T[] | Record<PropertyKey, T>, TReturn, TNext> {
  if (!isIterable(flows)) {
    const keys = Object.keys(flows);
    const _flows = Object.values(flows);

    const flow = combineLatest(_flows);

    return flow.do(
      map(values => {
        const out: Record<PropertyKey, T> = {};

        values.forEach((x, i) => {
          out[keys[i]!] = x;
        });

        return out;
      }),
    );
  }

  const _flows = Array.from(flows, toFlow);

  const allRepeatable = _flows.every(f => f.repeatable);

  const out: Flow<T[], TReturn, TNext> = defineFlow(async ({ emitScoped, scope }) => {
    let unsetCount = _flows.length;
    const items: Partial<Array<{ value: T; token: Token | undefined }>> = [];
    const waiters: Partial<
      Array<{ resolve: (value: TNext) => void; reject: (error: unknown) => void } | 'ready' | 'error'>
    > = [];

    const outerScope = scope;
    const loopCtrl = Token.createController();
    const loopScope = Scope.from([scope, loopCtrl]);
    let emitPending = false;
    let emitPromise: Promise<void> | undefined;

    let emitError: unknown;
    let lastInput!: TNext;

    let ret!: TReturn;

    await whenAllSettled(_flows, (fl, flowIndex) => {
      return fl
        .each(
          async ({ value, scope }): Promise<TNext> => {
            let token = undefined;

            if (!scope.token.isDefused) {
              const ctrl = Token.createController({
                filter: (error: Error) => {
                  if (error instanceof NewItemReceived) return error.deferred || 'defuse';
                  if (error instanceof FlowComplete) return 'defuse';
                  return true;
                },
              });
              ({ token } = ctrl);

              outerScope.token.add(
                token.add(() => {
                  if (!items[flowIndex]) return;
                  items[flowIndex] = undefined;
                  ++unsetCount;
                }),
              );
            }

            if (!items[flowIndex]) {
              --unsetCount;
            }

            items[flowIndex] = { value, token };

            if (unsetCount === 0 && !emitPending) {
              emitPending = true;
              const _emitPromise = (emitPromise = (emitPromise ?? Promise.resolve())
                .then(async () => {
                  emitPending = false;
                  const values: T[] = [];
                  const tokens: Token[] = [];

                  for (const item of items) {
                    if (!item || item.token?.isCancelled) return;
                    values.push(item.value);
                    if (item.token) {
                      tokens.push(item.token);
                    }
                  }

                  lastInput = await emitScoped({ value: values, scope: tokens });

                  for (const waiter of waiters) {
                    if (typeof waiter === 'object') {
                      waiter.resolve(lastInput);
                    }
                  }

                  waiters.fill('ready');
                })
                .catch(async error => {
                  emitPending = false;
                  try {
                    await loopCtrl.cancel(error);
                  } catch (e) {
                    error = e;
                  }

                  emitError = error;

                  for (const waiter of waiters) {
                    if (typeof waiter === 'object') {
                      waiter.reject(error);
                    }
                  }
                  waiters.fill('error');
                })
                .finally(() => {
                  if (emitPromise === _emitPromise) {
                    emitPromise = undefined;
                  }
                }));
            }

            if (waiters[flowIndex] === 'ready') {
              waiters[flowIndex] = undefined;
              return lastInput;
            }

            if (waiters[flowIndex] === 'error') {
              throw emitError;
            }

            return await new Promise((resolve, reject) => {
              waiters[flowIndex] = { resolve, reject };
            });
          },
          { scope: loopScope },
        )
        .then(x => {
          ret = x;
          return undefined;
        });
    });
    return ret;
  });

  return allRepeatable ? Object.assign(out, { repeatable: true }) : out;
}
