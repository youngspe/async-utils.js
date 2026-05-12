import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf } from '@youngspe/async-flows';
import { andThen, orCatch } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('andThen', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3);

    const appended = numbers.do(andThen(() => [4, 5, 6]));

    await appended.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [3], [4], [5], [6]]);
  });
});

suite('orCatch', () => {
  test('basic example', async () => {
    const failingFlow = defineFlow(async ({ emitAll }) => {
      await emitAll([1, 2, 3]);
      throw new Error('Oh no!');
    });

    const recovered = failingFlow.do(
      orCatch(() => {
        return [4, 5, 6];
      }),
    );

    await recovered.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [3], [4], [5], [6]]);
  });
});
