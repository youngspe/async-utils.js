import { suite, test } from 'node:test';

import { GenericEventEmitter, Scope, type EventControllerLike } from '@youngspe/async-scope';
import { flowFromEvent, flowFromAsyncEvent } from '@youngspe/async-flows';
import { collectArray, mapScoped, takeWhile } from '@youngspe/async-flows/ops';
import assert from 'node:assert/strict';
import { useFakeTimers } from '@private/test-utils/install-fake-timers';
import type { Awaitable } from '@youngspe/async-scope-common';

suite('flowFromEvent', () => {
  const { clock } = useFakeTimers();

  test('yield values from event', ({ signal }) =>
    Scope.from({ signal }).launch(async ({ scope }) => {
      const eventController = GenericEventEmitter.createController({}) satisfies EventControllerLike<
        number,
        undefined,
        false
      >;

      const flow = flowFromEvent(eventController.emitter);

      const [actual1, actual2] = await Promise.all([
        scope.launch(async ({ scope }) => {
          await scope.delay(25);
          const out = await flow.do(
            takeWhile(x => x < 7),
            collectArray(),
          );

          assert.equal(clock().now, 70);

          return out;
        }),
        scope.launch(async ({ scope }) => {
          await scope.delay(35);
          const out = await flow.do(
            takeWhile(x => x < 6),
            collectArray(),
          );

          assert.equal(clock().now, 60);

          return out;
        }),
        scope.launch(async ({ scope }) => {
          await scope.delay(10);
          eventController.emitAll(1);
          await scope.delay(10);
          eventController.emitAll(2);
          await scope.delay(10);
          eventController.emitAll(3);
          await scope.delay(10);
          eventController.emitAll(4);
          await scope.delay(10);
          eventController.emitAll(5);
          await scope.delay(10);
          eventController.emitAll(6);
          await scope.delay(10);
          eventController.emitAll(7);
          await scope.delay(10);
          eventController.emitAll(8);
          await scope.delay(10);
        }),
      ]);

      assert.deepEqual(actual1, [3, 4, 5, 6]);
      assert.deepEqual(actual2, [4, 5]);
      assert.equal(clock().now, 90);
    }));
});

suite('flowFromAsyncEvent', () => {
  const { clock } = useFakeTimers();
  const assertDuration = async <T>(block: () => Promise<T>, expected: number) => {
    const _clock = clock();
    const before = _clock.now;
    const out = await block();
    const after = _clock.now;
    assert.equal(after - before, expected);
    return out;
  };

  test('yield values from event and wait for handlers to complete', ({ signal }) =>
    Scope.from({ signal }).launch(async ({ scope }) => {
      const eventController = GenericEventEmitter.createController({
        isAsync: true,
      }) satisfies EventControllerLike<number, Awaitable<void>, true>;

      const flow = flowFromAsyncEvent(eventController.emitter);

      const [actual1, actual2] = await Promise.all([
        scope.launch(async ({ scope }) => {
          await scope.delay(25);
          const out = await flow.do(
            takeWhile(x => x < 7),
            mapScoped(async ({ value, scope }) => {
              if (value === 3) {
                await scope.delay(300);
              } else if (value === 4) {
                await scope.delay(100);
              }
              return value;
            }),
            collectArray(),
          );

          assert.equal(clock().now, 570);

          return out;
        }),
        scope.launch(async ({ scope }) => {
          await scope.delay(35);
          const out = await flow.do(
            takeWhile(x => x < 6),
            mapScoped(async ({ value, scope }) => {
              if (value === 4) {
                await scope.delay(200);
              }
              return value;
            }),
            collectArray(),
          );

          assert.equal(clock().now, 560);

          return out;
        }),
        scope.launch(async ({ scope }) => {
          await scope.delay(10);
          await eventController.emitAll(1);
          await scope.delay(10);
          await eventController.emitAll(2);
          await scope.delay(10);

          await assertDuration(async () => {
            await eventController.emitAll(3);
          }, 300);

          await scope.delay(10);

          await assertDuration(async () => {
            await eventController.emitAll(4);
          }, 200);

          await scope.delay(10);
          await eventController.emitAll(5);
          await scope.delay(10);
          await eventController.emitAll(6);
          await scope.delay(10);
          await eventController.emitAll(7);
          await scope.delay(10);
          await eventController.emitAll(8);
          await scope.delay(10);
        }),
      ]);

      assert.deepEqual(actual1, [3, 4, 5, 6]);
      assert.deepEqual(actual2, [4, 5]);
      assert.equal(clock().now, 590);
    }));
});
