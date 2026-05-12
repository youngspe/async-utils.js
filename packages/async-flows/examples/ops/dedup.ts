import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { flowOf } from '@youngspe/async-flows';
import { dedupByKey, dedup } from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('dedupByKey', () => {
  test('basic example', async () => {
    const flow = flowOf(
      { id: 1, name: 'a' },
      { id: 1, name: 'b' },
      { id: 2, name: 'c' },
      { id: 1, name: 'd' },
    ).do(dedupByKey(x => x.id));

    await flow.each(({ value }) => console.log(value.name));

    assert.deepEqual(getLogs(), [['a'], ['c'], ['d']]);
  });
});

suite('dedup', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 1, 2, 2, 3, 1, 1).do(dedup());

    await flow.each(({ value }) => console.log(value));

    assert.deepEqual(getLogs(), [[1], [2], [3], [1]]);
  });
});
