import { Scope, Token, type CancellableOptions, type TokenController } from '@youngspe/async-scope';

import { defineFlow, toFlow, type Flow, type ToFlow } from '#pkg/flow';
import {
  GenericLifecycle,
  type LifecycleEvent,
  type LifecycleHandlers,
  type StandardLifecycle,
  type StandardLifecycleState,
} from './lifecycle.ts';

/**
 * A lifecycle that receives state updates from a {@link Flow}.
 */
class FlowLifecycle<K extends PropertyKey, Ret> extends GenericLifecycle<K> {
  #events: Flow<LifecycleEvent<K>, Ret, undefined>;

  constructor(events: Flow<LifecycleEvent<K>, Ret, undefined>) {
    super();
    this.#events = events;
  }

  override in(handlers: LifecycleHandlers<K>, options?: CancellableOptions): Promise<Ret> {
    const cancelHandlers: Partial<Record<K, TokenController>> = {};

    return Scope.from(options).launch(({ scope, cancel }) => {
      const stack = scope.createStack();

      return this.#events.eachValue(
        async ({ event, state }) => {
          const oldCtrl = cancelHandlers[state];

          if (event === 'exit') {
            await oldCtrl?.cancel().finally(() => {
              if (cancelHandlers[state] === oldCtrl) {
                delete cancelHandlers[state];
              }
            });

            return;
          }

          const handler = handlers[state];
          if (!handler) return;

          const ctrl = Token.createController();
          const { token } = ctrl;
          cancelHandlers[state] = ctrl;

          // If there's an existing canceller, make sure it's all the way cancelled
          if (oldCtrl) {
            // Add this so ctrl.cancel() doesn't resolve until oldCtrl.cancel() resolves
            token.add(oldCtrl);
            await oldCtrl.cancel();
          }

          stack
            .pushScope({ token: ctrl.token })
            .runCancellable(handler, { token: ctrl.token })
            .catch(cancel);
        },
        { scope },
      );
    });
  }

  override flowIn(state: K): Flow<void, Ret, unknown> {
    const events = this.#events;

    return defineFlow(({ emitScoped, scope, cancel }) => {
      let ctrl: TokenController | undefined;

      return events.eachValue(async value => {
        if (value.state !== state) return;

        if (value.event === 'exit') {
          const _ctrl = ctrl;
          ctrl = undefined;
          await _ctrl?.cancel();
          return;
        }

        ctrl = scope.use(Token.createController());
        emitScoped({ value: undefined, scope: ctrl }, () => undefined).catch(cancel);
      });
    });
  }
}

/**
 * Creates a {@link GenericLifecycle} that gets its state from the given {@link Flow}.
 */
export function lifecycleFromFlow<
  const A extends readonly K[],
  const K extends PropertyKey = A[number],
  Ret = undefined,
>(flow: ToFlow<K | undefined, Ret, undefined>, states: A): GenericLifecycle<K, Ret>;
export function lifecycleFromFlow<const K extends PropertyKey, Ret = undefined>(
  flow: ToFlow<K | undefined, Ret, undefined>,
  states: readonly K[],
): GenericLifecycle<K, Ret>;
export function lifecycleFromFlow<const K extends PropertyKey, Ret = undefined>(
  flow: ToFlow<K | undefined, Ret, undefined>,
  states: readonly K[],
): GenericLifecycle<K, Ret> {
  const inverseStates: Partial<Record<K, number>> = {};

  let i = 0;
  for (const state of states) {
    inverseStates[state] = i++;
  }

  const _flow = toFlow(flow);

  return new FlowLifecycle(
    defineFlow(({ emit, scope }) => {
      let stateIndex = -1;

      const setState = async (newStateIndex: number): Promise<undefined> => {
        while (stateIndex < newStateIndex) {
          await emit({ event: 'enter', state: states[++stateIndex]! }, () => undefined);
        }

        while (stateIndex > newStateIndex) {
          await emit({ event: 'exit', state: states[stateIndex--]! }, () => undefined);
        }
      };

      return _flow
        .eachValue(
          async state => {
            const newStateIndex = state === undefined ? -1 : inverseStates[state];
            if (newStateIndex === undefined) return;

            return setState(newStateIndex);
          },
          { scope },
        )
        .finally(() => setState(-1));
    }),
  );
}

/**
 * Creates a {@link StandardLifecycle} that gets its state from the given {@link Flow}.
 */
export const standardLifecycleFromFlow = <Ret = undefined>(
  flow: ToFlow<StandardLifecycleState | undefined, Ret, undefined>,
): StandardLifecycle<Ret> => lifecycleFromFlow(flow, ['created', 'started', 'resumed']);
