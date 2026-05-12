/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf, type Flow } from '@youngspe/async-flows';
import { map, concatMap, mergeAll, filter } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('map', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);

    const doubleFlow = flow.do(map(value => value * 2));

    await doubleFlow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6]]);
  });
});

suite('concatMap', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);

    const flowWithRepeats = flow.do(
      concatMap(value =>
        defineFlow<number>(async ({ emit }) => {
          for (let i = 0; i < value; ++i) {
            await emit(value);
          }
        }),
      ),
    );

    await flowWithRepeats.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [2], [3], [3], [3]]);
  });
});

suite('mergeAll', () => {
  test('basic examples', async () => {
    const flow = defineFlow<Flow<string>>(async ({ scope, emit }) => {
      await emit(
        defineFlow(async ({ scope, emit }) => {
          await scope.delay(200);

          // 200ms
          await emit('a1');

          await scope.delay(30);

          // 230ms
          await emit('a2');
        }),
      );

      await scope.delay(50);

      await emit(
        defineFlow(async ({ scope, emit }) => {
          await scope.delay(50);

          // 100ms
          await emit('b1');

          await scope.delay(60);

          // 160ms
          await emit('b2');

          await scope.delay(50);

          // 210ms
          await emit('b3');
        }),
      );

      await scope.delay(30);

      await emit(
        defineFlow(async ({ scope, emit }) => {
          await scope.delay(40);

          // 120ms
          await emit('c1');

          await scope.delay(50);

          // 170ms
          await emit('c2');

          await scope.delay(10);

          // 180ms
          await emit('c3');

          await scope.delay(60);

          // 240ms
          await emit('c4');
        }),
      );
    });

    const merged = flow.do(mergeAll());

    await merged.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [['b1'], ['c1'], ['b2'], ['c2'], ['c3'], ['a1'], ['b3'], ['a2'], ['c4']]);
  });
});

suite('filter', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const evens = numbers.do(filter(n => n % 2 === 0));

    await evens.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6], [8], [10]]);
  });
});
