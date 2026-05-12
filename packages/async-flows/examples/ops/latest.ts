import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf } from '@youngspe/async-flows';
import { latest, switchLatest, switchMap } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('latest', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3).do(latest());

    await flow.each(async ({ value, scope }) => {
      console.log(value);
      await scope.delay(10);
    });

    assert.deepEqual(getLogs(), [[1], [3]]);
  });
});

suite('switchLatest', () => {
  test('basic example', async () => {
    const flow = flowOf(
      defineFlow<number>(async ({ emit }) => {
        await emit(1);
      }),
      defineFlow<number>(async ({ emit }) => {
        await emit(2);
      }),
    ).do(switchLatest());

    await flow.each(({ value }) => console.log(value)).catch(() => {});
  });
});

suite('switchMap', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3).do(switchMap(n => [n, n * 2]));

    await flow.each(({ value }) => console.log(value)).catch(() => {});
  });
});
