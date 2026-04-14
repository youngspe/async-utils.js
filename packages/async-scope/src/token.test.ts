import { suite, test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { Token } from './token.ts';
import { delay } from './timers.ts';

suite('CancelEvent', () => {
  useFakeTimers();

  test('a listener is called on cancel', async () => {
    const ctrl = Token.createController();
    const { token } = ctrl;

    const listener = mock.fn<(error: Error) => void>();
    token.add(listener);

    const err = new Error();

    await ctrl.cancel(err);

    assert.equal(listener.mock.callCount(), 1);
    assert.equal(listener.mock.calls[0]?.arguments.length, 1);
    assert.equal(listener.mock.calls[0].arguments[0], err);
  });

  suite('a listener is not called more than once', () => {
    test('with two successive cancel calls', async () => {
      const ctrl = Token.createController();
      const { token } = ctrl;

      const listener = mock.fn<(error: Error) => void>();
      token.add(listener);

      await ctrl.cancel();
      await ctrl.cancel();

      assert.equal(listener.mock.callCount(), 1);
    });
    test('with two concurrent cancel calls', async () => {
      const ctrl = Token.createController();
      const { token } = ctrl;

      const listener = mock.fn<(error: Error) => void>();
      token.add(listener);

      await Promise.all([ctrl.cancel(), ctrl.cancel()]);

      assert.equal(listener.mock.callCount(), 1);
    });
  });

  test('cancel() resolves after all listeners', async () => {
    const ctrl = Token.createController();
    const { token } = ctrl;

    const events: number[] = [];

    token.add([
      ...[3, 2, 5, 4, 1].map(i => async () => {
        await delay(i);
        events.push(i);
      }),
    ]);

    const promise = ctrl.cancel();
    assert.deepEqual(events, []);
    await promise;
    assert.deepEqual(events, [1, 2, 3, 4, 5]);
  });
});
