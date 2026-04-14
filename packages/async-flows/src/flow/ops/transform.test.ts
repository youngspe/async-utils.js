import { suite, test } from 'node:test';
import assert from 'node:assert/strict';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { defineFlow, flowOf, type ToFlow } from '@youngspe/async-flows';
import { collectArray, flat, flatMap, map } from '@youngspe/async-flows/ops';

suite('ops', () => {
  const { clock } = useFakeTimers();

  suite('map', () => {
    test('simple multiply', async ({ signal }) => {
      const flow = flowOf(1, 2, 3, 4, 5);

      const mapped = flow.to(map(x => x * 2));

      const expected = [2, 4, 6, 8, 10];
      const actual = await mapped.to(collectArray({ signal }));

      assert.deepEqual(actual, expected);
    });

    test('async multiply', async ({ signal }) => {
      const flow = defineFlow<number>(async ({ emit, scope }) => {
        await emit(1);
        await scope.delay(10);
        await emit(2);
        await scope.delay(10);
        await emit(3);
        await scope.delay(10);
        await emit(4);
        await scope.delay(10);
        await emit(5);
        await scope.delay(10);
      });

      const mapped = flow.to(map(x => x * 2));

      const expected = [2, 4, 6, 8, 10];
      const actual = await mapped.to(collectArray({ signal }));

      assert.deepEqual(actual, expected);
      assert.equal(clock().now, 50);
    });
  });

  suite('flat', () => {
    test('simple flatten', async ({ signal }) => {
      const flow = flowOf(
        [1, 2, 3],
        flowOf(4, 5, 6),
        defineFlow(async ({ emit, scope }) => {
          await scope.delay(10);
          await emit(7);
          await scope.delay(10);
          await emit(8);
          await scope.delay(10);
          await emit(9);
          await scope.delay(10);
        }),
      );

      const flattened = flow.to(flat());

      const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const actual = await flattened.to(collectArray({ signal }));

      assert.deepEqual(actual, expected);
      assert.equal(clock().now, 40);
    });

    test('async flatten', async ({ signal }) => {
      const flow = defineFlow<ToFlow<number, undefined, unknown>>(async ({ emit, scope }) => {
        await scope.delay(100);
        await emit([1, 2, 3]);
        await scope.delay(100);
        await emit(flowOf(4, 5, 6));
        await scope.delay(100);
        await emit(
          defineFlow(async ({ emit, scope }) => {
            await scope.delay(10);
            await emit(7);
            await scope.delay(10);
            await emit(8);
            await scope.delay(10);
            await emit(9);
            await scope.delay(10);
            return undefined;
          }),
        );
        await scope.delay(100);
      });

      const flattened = flow.to(flat());

      const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const actual = await flattened.to(collectArray({ signal }));

      assert.deepEqual(actual, expected);
      assert.equal(clock().now, 440);
    });
  });

  suite('flatMap', () => {
    test('simple flat map', async ({ signal }) => {
      const flow = flowOf(0, 1, 2, 3, 4);

      const flatMapped = flow.to(flatMap(x => flowOf(x * 3, x * 3 + 1, x * 3 + 2)));

      const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
      const actual = await flatMapped.to(collectArray({ signal }));

      assert.deepEqual(actual, expected);
    });
  });
});
