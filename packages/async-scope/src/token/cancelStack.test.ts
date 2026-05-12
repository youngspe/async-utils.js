import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { Token } from '#pkg';
import { isPromiseLike } from '@youngspe/common-async-utils';

suite('CancelStack', () => {
  test('simple synchronous cancellables', async () => {
    await using ctrl = Token.createController();
    const { token, tryCancelSync } = ctrl;

    const events: Array<[string, string]> = [];

    const stack = token.createStack();
    const error = new Error('test');

    stack.push(e => void events.push([e.message, 'a']));
    stack.push(e => void events.push([e.message, 'b']));
    stack.push(e => void events.push([e.message, 'c']));

    const ret = tryCancelSync(error);

    assert(!isPromiseLike(ret));

    const expectedEvents: typeof events = ['c', 'b', 'a'].map(x => [error.message, x]);

    assert.deepEqual(events, expectedEvents);
  });
});
