import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf } from '@youngspe/async-flows';
import {
  collectArray,
  collectMap,
  collectSet,
  associate,
  drain,
  feedback,
} from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('collectArray', () => {
  test('basic example', async () => {
    const array = await flowOf(1, 2, 3).do(collectArray());

    console.log(array);

    assert.deepEqual(array, [1, 2, 3]);
  });
});

suite('collectSet', () => {
  test('basic example', async () => {
    const set = await flowOf(1, 2, 2, 3, 3, 3).do(collectSet());

    console.log(Array.from(set));

    assert.deepEqual(Array.from(set), [1, 2, 3]);
  });
});

suite('collectMap', () => {
  test('basic example', async () => {
    const keyed = await flowOf<[string, number]>(['a', 1], ['b', 2], ['c', 3]).do(collectMap());

    console.log(Array.from(keyed));

    assert.deepEqual(Array.from(keyed), [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });
});

suite('associate', () => {
  test('basic example', async () => {
    const indexed = await flowOf(10, 20, 30).do(associate(async n => `key-${n}`));

    console.log(Array.from(indexed));

    assert.deepEqual(Array.from(indexed), [
      ['key-10', 10],
      ['key-20', 20],
      ['key-30', 30],
    ]);
  });
});

suite('drain', () => {
  test('basic example', async () => {
    const cleanup = defineFlow(async ({ emit }) => {
      console.log(1);
      await emit(1);

      console.log(2);
      await emit(2);

      console.log(3);
      await emit(3);

      return 'done';
    });

    const drained = await cleanup.do(drain());

    console.log(drained);

    assert.equal(drained, 'done');
    assert.deepEqual(getLogs(), [[1], [2], [3], ['done']]);
  });
});

suite('feedback', () => {
  test('basic example', async () => {
    const result = await defineFlow(async ({ emit }) => {
      await emit(1);
      return 42;
    }).do(feedback());

    console.log(result);

    assert.equal(result, 42);
  });
});
