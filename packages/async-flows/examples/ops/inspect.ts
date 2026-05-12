/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf } from '@youngspe/async-flows';
import {
  inspect,
  inspectComplete,
  inspectError,
  inspectFinally,
  inspectStart,
} from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('inspect', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3);

    const logged = numbers.do(inspect(value => console.log('Value:', value)));

    await logged.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [['Value:', 1], [1], ['Value:', 2], [2], ['Value:', 3], [3]]);
  });
});

suite('inspectError', () => {
  test('basic example', async () => {
    const failingFlow = defineFlow(async ({ emit }) => {
      await emit(1);
      throw new Error('Test error');
    });

    const logged = failingFlow.do(inspectError(error => console.log(String(error))));

    await logged
      .each(() => {
        // Consume the flow
      })
      .catch(() => {});

    assert.deepEqual(getLogs(), [['Error: Test error']]);
  });
});

suite('inspectStart', () => {
  test('basic example', async () => {
    const started = flowOf(1, 2, 3)
      .do(inspectStart(() => console.log('Starting...')))
      .do(inspectComplete(() => console.log('Done!')));

    await started.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [['Starting...'], [1], [2], [3], ['Done!']]);
  });
});

suite('inspectFinally', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);
    const finallyLogged = flow.do(
      inspectFinally(cx => console.log('Finally:', cx.error ? 'error' : 'success')),
    );

    await finallyLogged
      .each(() => {
        // Consume the flow
      })
      .catch(() => {});

    assert.deepEqual(getLogs(), [['Finally:', 'success']]);
  });

  test('with error', async () => {
    const failingFlow = defineFlow(async ({ emit }) => {
      await emit(1);
      throw new Error('Test error');
    });

    const finallyLogged = failingFlow.do(inspectError(error => console.log('Caught', String(error))));

    await finallyLogged
      .each(() => {
        // Consume the flow
      })
      .catch(() => {});

    assert.deepEqual(getLogs(), [['Caught', 'Error: Test error']]);
  });
});
