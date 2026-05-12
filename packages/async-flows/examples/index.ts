/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite, mock, beforeEach, afterEach, type Mock } from 'node:test';
import assert from 'node:assert/strict';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { defineFlow, emptyFlow, flowOf, toFlow } from '@youngspe/async-flows';

let log!: Mock<(...args: any) => void>;
useFakeTimers();

beforeEach(() => {
  log = mock.method(console, 'log');
  log.mock.mockImplementation(() => {});
});
afterEach(() => {
  mock.restoreAll();
});

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
      log.mock.calls.map(c => c.arguments),
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
      log.mock.calls.map(c => c.arguments),
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
      log.mock.calls.map(c => c.arguments),
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
      log.mock.calls.map(c => c.arguments),
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
      log.mock.calls.map(c => c.arguments),
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
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [3], ['hello']],
    );
  });
});
