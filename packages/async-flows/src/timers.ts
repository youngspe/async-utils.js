import { GlobalClock, Scope, Token, type TimerOptions, type TokenController } from '@youngspe/async-scope';

import { defineFlow, Flow } from './flow.ts';

export interface IntervalOptions extends TimerOptions {
  /**
   * How to recover from a lagged execution.
   * This is useful when the interval is executed more frequently than expected.
   *
   * - `'restart'`: Restart the interval schedule from the time execution is complete.
   * - `'resume'`: Keep the existing interval schedule.
   * - `'skip'`: Keep the existing interval schedule but skip the next event.
   *
   * @default `'resume'`
   */
  lagRecovery?: 'restart' | 'resume' | 'skip' | undefined;
  /**
   * How to handle events missed due to execution lag.
   * This is useful when the interval is executed more frequently than expected.
   *
   * - `number`: the number of missed events that should be executed after the current handler
   *    execution ends. For example, if `3`, then the handler will be called again three times after
   *    a handler is complete if it took longer than the interval duration to run.
   * - `true`: equivalent to `1`, meaning the handler will be called again once if it takes longer
   *    than the interval duration to run.
   * - `false`: equivalent to `0`, meaning all events that would fire during a lagging handler
   *    execution are dropped.
   *
   * @default `true`
   */
  lagQueue?: number | boolean | undefined;
  skipFirst?: boolean;
}

export function interval(ms: number, options?: IntervalOptions): Flow<number, never, unknown> {
  const {
    clock: { setInterval, clearInterval } = GlobalClock,
    lagQueue = true,
    lagRecovery = 'resume',
    skipFirst = true,
  } = options ?? {};

  let controller: TokenController | undefined;

  switch (lagRecovery) {
    case 'restart':
      break;
    case 'resume':
    case 'skip':
      controller = Token.createController();
  }

  const maxQueue = Number(lagQueue);

  let executing = false;

  let droppedCount = 0;
  let index = 0;
  let shouldSkip = false;
  let emitScope: Scope | undefined;

  return defineFlow<number, never, unknown>(
    ({ emitScoped, token }): Promise<never> =>
      new Promise((_resolve, reject) => {
        let timerId: ReturnType<typeof setInterval> | undefined;

        token.add(() => {
          clearInterval(timerId);
        });

        const intervalHandler = () =>
          void (async () => {
            if (executing) {
              if (controller) {
                const ctrl = controller;
                emitScope = undefined;
                controller = Token.createController();
                ctrl.cancel().catch(reject);
              }

              if (lagRecovery === 'skip') {
                shouldSkip = true;
              } else if (lagRecovery === 'restart') {
                clearInterval(timerId);
                timerId = undefined;
              }

              if (droppedCount < maxQueue) {
                ++droppedCount;
              } else {
                ++index;
              }

              return;
            }

            executing = true;

            ++index;

            if (shouldSkip) return;
            shouldSkip = false;

            emitScope ??= controller && Scope.from(controller);

            await emitScoped({ value: index, scope: emitScope }, () => {});

            while (droppedCount > 0) {
              --droppedCount;
              ++index;

              emitScope ??= controller && Scope.from(controller);
              await emitScoped({ value: index, scope: emitScope }, () => {});
            }

            if (timerId === undefined) {
              timerId = setInterval(intervalHandler, ms);
            }
            executing = false;
          })().catch(reject);

        timerId = setInterval(intervalHandler, ms);
        if (!skipFirst) {
          --index;
          void intervalHandler();
        }
      }),
    options,
  );
}
