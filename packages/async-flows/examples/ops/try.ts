/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { flowOf } from '@youngspe/async-flows';
import { tryMap } from '@youngspe/async-flows/ops';

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
