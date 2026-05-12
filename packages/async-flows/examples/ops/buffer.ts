/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { flowOf } from '@youngspe/async-flows';
import { buffer, buffers, inspectScoped } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('buffer', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10).do(
      inspectScoped(async ({ value, scope }) => {
        if (value % 5 === 0) {
          await scope.delay(100);
        }
        console.log('Emitting:', value);
      }),
    );
    const buffered = flow.do(buffer(3));

    await buffered.each(async ({ value, scope }) => {
      console.log(value);
      await scope.delay(10);
    });

    assert.deepEqual(getLogs(), [
      ['Emitting:', 1],
      [1],
      ['Emitting:', 2],
      ['Emitting:', 3],
      ['Emitting:', 4],
      [2],
      [3],
      [4],
      ['Emitting:', 5],
      [5],
      ['Emitting:', 6],
      ['Emitting:', 7],
      ['Emitting:', 8],
      [6],
      ['Emitting:', 9],
      [7],
      [8],
      [9],
      ['Emitting:', 10],
      [10],
    ]);
  });
});

suite('buffers', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const buffered = flow.do(buffers(3));

    await buffered.each(async ({ value, scope }) => {
      console.log(...value);
      await scope.delay(10);
    });

    assert.deepEqual(getLogs(), [[1], [2, 3, 4], [5, 6, 7], [8, 9, 10]]);
  });
});
