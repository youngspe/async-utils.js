import {
  Subscription,
  Token,
  type CommonScopeOptions,
  Scope,
  GenericEventEmitter,
  type CancellableOptions,
} from '@youngspe/async-scope';
import { signals as killSignals } from 'signal-exit/signals';
import { signalEvents } from './sig.ts';
import { Termination } from './termination.ts';
import type { Awaitable } from './types.ts';

const _exitEvent: GenericEventEmitter<Termination, Awaitable<void>> = GenericEventEmitter.create({
  init: ({ getListeners }) => {
    let promise: Promise<void> | undefined;

    let term: Termination | undefined;
    let forceQuit: (() => void) | undefined;

    const emit = (reason: Termination): void => {
      if (!term || reason.severity > term.severity) {
        process.exitCode ||= reason.exitCode;
        term = reason;
      }

      if (!promise) {
        let resolve!: (_: Promise<void>) => void;

        promise = new Promise(r => {
          resolve = r;
        });

        resolve(
          (promise = (async () => {
            let listeners;

            {
              using ls = getListeners();
              listeners = Array.from(ls.listeners());
            }

            // eslint-disable-next-line @typescript-eslint/await-thenable
            const results = await Promise.allSettled(listeners.map(l => l(term ?? reason)));

            const errors = new Set(
              results.flatMap((r): unknown[] =>
                r.status === 'rejected' && !(r.reason instanceof Termination) ? [r.reason] : [],
              ),
            );

            if (errors.size === 0) return;
            if (errors.size > 1) throw new AggregateError(errors);

            const [error] = errors;
            throw error;
          })()
            .catch(error => {
              process.exitCode ||= 1;
              console.error(error);
            })
            .finally(() => forceQuit)),
        );
      }
    };

    const subs = killSignals.map(sig => signalEvents.on(sig, emit, { once: true, paused: true }));

    subs.push(
      Subscription.fromLifecycle({
        paused: true,
        init: () => ({
          resume: () => {
            // eslint-disable-next-line @typescript-eslint/unbound-method
            const oldExit = process.exit;

            let forceQuitInit = false;

            forceQuit = () => {
              if (!forceQuitInit) return;
              forceQuitInit = true;
              const timer = setTimeout(() => oldExit(process.exitCode), 2_000);
              timer.unref();
            };

            process.exit = code => {
              if (code) {
                process.exitCode ||= Number(code);
              }
              const term = new Termination.Exit(process.exitCode == null ? 0 : Number(process.exitCode));
              emit(term);
              throw term;
            };

            const exitHandler = (code: number) => emit(new Termination.Exit(code));
            const uncaughtHandler = (error: unknown) => emit(new Termination.Uncaught(error));

            process.once('beforeExit', exitHandler).once('exit', exitHandler);

            if (!term) {
              process.on('uncaughtException', uncaughtHandler).on('unhandledRejection', uncaughtHandler);
            }

            return {
              pause: () => {
                process.exit = oldExit;
                process.off('beforeExit', exitHandler).off('exit', exitHandler);

                if (!term) {
                  process
                    .off('uncaughtException', uncaughtHandler)
                    .off('unhandledRejection', uncaughtHandler);
                }
              },
            };
          },
        }),
      }),
    );

    const sub = Subscription.collect(subs);

    return {
      resume: () => {
        sub.resume();
        return {
          pause: () => {
            sub.pause();
          },
        };
      },
      close: () => {
        sub.dispose();
      },
    };
  },
});

export function onExit(
  listener: (term: Termination) => Awaitable<void>,
  options?: CancellableOptions & { paused?: boolean | undefined },
): Subscription {
  return _exitEvent.add(listener, { once: true, paused: options?.paused, token: options });
}

let _exitScope: Scope | undefined;

function createExitScope(): Scope {
  const token = Token.create({
    init: ({ cancel }) => {
      const sub = _exitEvent.add(cancel, { once: true, paused: true });

      return {
        resume: () => {
          sub.resume();
          return { pause: () => sub.pause() };
        },
        close: () => sub.dispose(),
      };
    },
  });

  return Scope.from(token);
}

export function exitScope(options?: CommonScopeOptions): Scope {
  return Scope.from([(_exitScope ??= createExitScope()), options]);
}
