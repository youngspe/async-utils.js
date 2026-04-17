import { suite, test } from 'node:test';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { Scope } from '@youngspe/async-scope';
import { defineFlow } from '@youngspe/async-flows';
import { collectArray, share, takeWhile } from '@youngspe/async-flows/ops';
import assert, { AssertionError } from 'node:assert/strict';

suite('ops', () => {
  const { clock } = useFakeTimers();
  suite('share', () => {
    test('yield values from flow', ({ signal }) =>
      Scope.from({ signal }).launch(async ({ scope }) => {
        const flow = defineFlow(async ({ emit, scope }) => {
          await emit(1);
          await scope.delay(10);
          await emit(2);
          await scope.delay(15);
          await emit(3);
        }).do(share({ scope }));

        const actual = await flow.do(collectArray());
        const expected = [1, 2, 3];

        assert.deepEqual(actual, expected);
        assert.equal(clock().now, 25);
      }));

    test('only run once when collected simultaneously', ({ signal }) =>
      Scope.from({ signal }).launch(async ({ scope }) => {
        let visits = 0;

        const flow = defineFlow(async ({ emit, scope }) => {
          ++visits;
          await emit(1);
          await scope.delay(10);
          await emit(2);
          await scope.delay(15);
          await emit(3);
        }).do(share({ scope }));

        const [actual1, actual2] = await Promise.all([flow.do(collectArray()), flow.do(collectArray())]);
        const expected = [1, 2, 3];

        assert.deepEqual(actual1, expected);
        assert.deepEqual(actual2, expected);
        assert.equal(clock().now, 25);
        assert.equal(visits, 1);
      }));

    test('handle when one collector is cancelled', ({ signal }) =>
      Scope.from({ signal }).launch(async ({ scope }) => {
        let visits = 0;

        const flow = defineFlow<number>(async ({ emit, scope }) => {
          ++visits;
          await emit(1);
          await scope.delay(10);
          await emit(2);
          await scope.delay(15);
          await emit(3);
        }).do(share({ scope }));

        const [actual1, actual2] = await Promise.all([
          flow.do(collectArray()),
          flow.do(
            takeWhile(x => x <= 2),
            collectArray(),
          ),
        ]);

        assert.deepEqual(actual1, [1, 2, 3]);
        assert.deepEqual(actual2, [1, 2]);
        assert.equal(clock().now, 25);
        assert.equal(visits, 1);
      }));

    test('handle a collector starting in-progress', ({ signal }) =>
      Scope.from({ signal }).launch(async ({ scope }) => {
        let visits = 0;

        const flow = defineFlow<number>(async ({ emit, scope }) => {
          ++visits;
          await emit(1);
          await scope.delay(10);
          await emit(2);
          await scope.delay(15);
          await emit(3);
          await scope.delay(20);
        }).do(share({ scope }));

        const [actual1, actual2] = await Promise.all([
          flow.do(collectArray()),
          scope.launch(async ({ scope }) => {
            await scope.delay(5);
            return await flow.do(collectArray());
          }),
        ]);

        assert.deepEqual(actual1, [1, 2, 3]);
        assert.deepEqual(actual2, [2, 3]);
        assert.equal(clock().now, 45);
        assert.equal(visits, 1);
      }));
    test('handle a collector starting in-progress while another is cancelled', ({ signal }) =>
      Scope.from({ signal }).launch(async ({ scope }) => {
        let visits = 0;

        const flow = defineFlow<number>(async ({ emit, scope }) => {
          ++visits;
          await emit(1);
          await scope.delay(10);
          await emit(2);
          await scope.delay(15);
          await emit(3);
          await scope.delay(20);
        }).do(share({ scope }));

        const [actual1, actual2] = await Promise.all([
          flow.do(
            takeWhile(x => x <= 2),
            collectArray(),
          ),
          scope.launch(async ({ scope }) => {
            await scope.delay(5);
            return await flow.do(collectArray());
          }),
        ]);

        assert.deepEqual(actual1, [1, 2]);
        assert.deepEqual(actual2, [2, 3]);
        assert.equal(clock().now, 45);
        assert.equal(visits, 1);
      }));
    test('handle all listeners cancelling early', ({ signal }) =>
      Scope.from({ signal }).launch(async ({ scope, cancel }) => {
        let visits = 0;

        const flow = defineFlow<number>(async ({ emit, scope }) => {
          ++visits;
          await emit(1);
          await scope.delay(10);
          await emit(2);
          await scope.delay(15);
          await emit(3);
          await scope.delay(20);

          cancel(new AssertionError({ message: 'this should not be called' }));
        }).do(share({ scope }));

        const [actual1, actual2] = await Promise.all([
          flow.do(
            takeWhile(x => x <= 2),
            collectArray(),
          ),
          scope.launch(async ({ scope }) => {
            await scope.delay(5);
            return await flow.do(
              takeWhile(x => x <= 2),
              collectArray(),
            );
          }),
        ]);

        assert.deepEqual(actual1, [1, 2]);
        assert.deepEqual(actual2, [2]);
        assert.equal(clock().now, 25);
        assert.equal(visits, 1);
      }));
  });
});
