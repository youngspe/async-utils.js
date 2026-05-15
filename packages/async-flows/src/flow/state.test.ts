import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { sharedFlowController } from './shared.ts';
import { Scope } from '@youngspe/async-scope';
import { useFakeTimers } from '@private/test-utils/install-fake-timers';

useFakeTimers();

suite('StateFlow', () => {
  test('observe after assigning', async ({ signal }) => {
    const scope = Scope.from(signal);
    const ctrl = sharedFlowController<number, never>();

    const flow = ctrl.flow.state({ scope });

    await ctrl.emit(1);

    const actual: number[] = [];

    await scope.race([
      ({ scope }) =>
        flow.eachValue(
          x => {
            actual.push(x);
          },
          { scope },
        ),
      async ({ scope }) => {
        await scope.delay(100);
        await ctrl.emit(2);
      },
    ]);

    assert.deepEqual(actual, [1, 2]);
  });
});
