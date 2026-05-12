import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf } from '@youngspe/async-flows';
import { tryMap, tryTransformEach } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('tryMap', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5);

    const mapped = numbers.do(
      tryMap(n => {
        if (n === 4) return { break: undefined };
        return { continue: n * 2 };
      }),
    );

    await mapped.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6]]);
  });
});

suite('tryTransformEach', () => {
  test('basic example', async () => {
    const flow = defineFlow<number>(async ({ emit }) => {
      await emit(1);
      await emit(2);
      await emit(3);
      await emit(4);
      await emit(5);
    }).do(
      tryTransformEach(async ({ value, emit }) => {
        if (value === 4) return { break: undefined as never };
        return { continue: emit(value * 2) };
      }),
    );

    await flow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6]]);
  });
});
