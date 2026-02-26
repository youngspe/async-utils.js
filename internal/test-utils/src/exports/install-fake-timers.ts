import { beforeEach, afterEach } from 'node:test';
import { AssertionError } from 'node:assert';

import { install, type Clock } from '@sinonjs/fake-timers';

const LOOP_LIMIT = 1_000;
export const installFakeTimers = (): Clock & AsyncDisposable => {
  const errors: unknown[] = [];

  const clock = install({ shouldClearNativeTimers: true });
  let disposed = false;

  const runPromise = (async () => {
    let i = 0;

    while (!disposed || clock.countTimers() > 0) {
      if (i++ >= LOOP_LIMIT) {
        errors.push(
          new AssertionError({ message: `Looped ${LOOP_LIMIT} times waiting for timers to complete` }),
        );
      }

      try {
        await clock.runAllAsync();
      } catch (e) {
        errors.push(e);
      }
    }
  })();

  runPromise.catch(() => {});

  return Object.assign(clock, {
    [Symbol.asyncDispose]: async () => {
      if (disposed) return;
      disposed = true;

      await runPromise;
      clock.reset();
      clock.uninstall();

      if (errors.length > 0) {
        throw Object.assign(new Error(`${errors.length} uncaught error(s) in timers`), { errors });
      }
    },
  });
};

export function useFakeTimers() {
  let installedClock: (Clock & AsyncDisposable) | undefined;

  beforeEach(() => {
    installedClock = installFakeTimers();
  });

  afterEach(async () => {
    await installedClock?.[Symbol.asyncDispose]();
    installedClock = undefined;
  });

  return {
    clock: (): Clock => {
      if (installedClock) return installedClock;

      throw new Error('clock() called outside of test');
    },
  };
}
