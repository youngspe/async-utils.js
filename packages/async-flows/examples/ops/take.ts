import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { flowOf } from '@youngspe/async-flows';
import { take, takeWhile } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('take', () => {
  test('take N values', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const firstFive = numbers.do(take(5));

    await firstFive.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [3], [4], [5]]);
  });
});

suite('takeWhile', () => {
  test('basic example', async () => {
    const evens = flowOf(1, 2, 3, 4, 5, 6, 7, 8).do(takeWhile(n => n < 5));

    await evens.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [3], [4]]);
  });
});
