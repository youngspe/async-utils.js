import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { flowOf } from '@youngspe/async-flows';
import { buffer, buffers, bufferReduce, inspectScoped, tryBufferReduce } from '@youngspe/async-flows/ops';

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

suite('bufferReduce', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3, 4, 5).do(
      bufferReduce(
        async ({ value, emit }, sum) => {
          const newSum = sum + value;
          await emit(newSum);
          return newSum;
        },
        () => 0,
        async ({ value }, sum) => {
          console.log(sum);
          return value;
        },
      ),
    );

    await flow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [3], [6], [10], [15], [15]]);
  });
});

suite('tryBufferReduce', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3, 4, 5).do(
      tryBufferReduce(
        async ({ value, emit }, sum: number) => {
          const newSum = sum + value;
          await emit(newSum);
          return { continue: newSum };
        },
        async () => ({ continue: 0 }),
        async ({ value }, sum) => {
          console.log(sum);
          return { continue: value };
        },
      ),
    );

    await flow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [3], [6], [10], [15], [15]]);
  });
});
