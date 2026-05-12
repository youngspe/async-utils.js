/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, emptyFlow, flowOf, toFlow } from '@youngspe/async-flows';

import { getLogs } from './_init.ts';

suite('defineFlow', () => {
  test('basic example', async () => {
    const flow = defineFlow<number, string>(async ({ scope, emit }) => {
      await emit(1);

      await scope.delay(1000);

      await emit(2);

      await scope.delay(1000);

      await emit(3);

      await scope.delay(1000);

      return 'hello';
    });

    const out = await flow.each(({ value }) => {
      console.log(value);
    });

    console.log(out);

    // Output:
    // 1
    // 2
    // 3
    // hello

    assert.deepEqual(
      getLogs(),
      [[1], [2], [3], ['hello']],
    );
  });
});

suite('flowOf', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);

    await flow.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 3

    assert.deepEqual(
      getLogs(),
      [[1], [2], [3]],
    );
  });
});

suite('emptyFlow', () => {
  test('basic example', async () => {
    const flow = emptyFlow();

    await flow.each(({ value }) => {
      console.log(value);
    });

    // No output

    assert.deepEqual(
      getLogs(),
      [],
    );
  });

  test('basic example', async () => {
    const flow = emptyFlow('hello');

    const out = await flow.each(({ value }) => {
      console.log(value);
    });

    console.log(out);

    // Output:
    // hello

    assert.deepEqual(
      getLogs(),
      [['hello']],
    );
  });
});

suite('toFlow', () => {
  test('from an iterable', async () => {
    const flow = toFlow([1, 2, 3]);

    await flow.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 3

    assert.deepEqual(
      getLogs(),
      [[1], [2], [3]],
    );
  });

  test('from an async iterable', async () => {
    const flow = toFlow<number, string>(
      (async function* () {
        yield 1;
        yield 2;
        yield 3;
        return 'hello';
      })(),
    );

    const out = await flow.each(({ value }) => {
      console.log(value);
    });

    console.log(out);

    // Output:
    // 1
    // 2
    // 3
    // hello

    assert.deepEqual(
      getLogs(),
      [[1], [2], [3], ['hello']],
    );
  });
});
