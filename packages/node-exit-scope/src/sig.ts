import type { CancellableOptions } from '@youngspe/async-scope';
import { GenericEventEmitter, type Subscription } from '@youngspe/async-scope/events';

import { Termination } from './termination.ts';
import type { Awaitable } from './types.ts';

type SignalEmitter<S extends NodeJS.Signals = NodeJS.Signals> = GenericEventEmitter<
  Termination.Signal<S>,
  Awaitable<boolean | void>
>;

interface SignalEventListenerOptions extends CancellableOptions {
  paused?: boolean | undefined;
}

export class SignalEvents {
  #emitters: { [_ in NodeJS.Signals]?: SignalEmitter<any> } = {};

  #getEmitter<Sig extends NodeJS.Signals>(event: Sig): SignalEmitter<Sig> {
    const existing = this.#emitters[event];

    if (existing) return existing as SignalEmitter<Sig>;

    return (this.#emitters[event] ??= GenericEventEmitter.create<
      Termination.Signal<Sig>,
      Awaitable<void | boolean>,
      true
    >({
      isAsync: true,
      init: () => ({
        resume: ({ getListeners }) => {
          const handler = () =>
            void Promise.resolve(getListeners()).then(async _ls => {
              using ls = _ls;
              const errors = new Set();
              const reason = new Termination.Signal(event);

              for (const l of ls.listenersReversed()) {
                try {
                  const ret = await l(reason);

                  if (ret === true) break;
                } catch (e) {
                  if (e !== reason) {
                    errors.add(e);
                  }
                }
              }
            });

          process.on(event, handler);

          return {
            pause: () => {
              process.off(event, handler);
            },
          };
        },
      }),
    }));
  }

  on<Sig extends NodeJS.Signals>(
    event: Sig,
    listener: (reason: Termination.Signal<Sig>) => Awaitable<boolean | void>,
    options?: SignalEventListenerOptions & { once?: boolean | undefined },
  ): Subscription {
    const emitter = this.#getEmitter(event);

    return emitter.add(listener, { once: options?.once, paused: options?.paused, token: options });
  }

  once<Sig extends NodeJS.Signals>(
    event: Sig,
    listener: (reason: Termination.Signal<Sig>) => Awaitable<boolean>,
    options?: SignalEventListenerOptions,
  ): Subscription {
    return this.on(event, listener, { ...options, once: true });
  }
}

export const signalEvents = new SignalEvents();
