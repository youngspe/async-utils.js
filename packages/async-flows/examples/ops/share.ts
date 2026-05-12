/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow } from '@youngspe/async-flows';
import { share } from '@youngspe/async-flows/ops';
import { Scope } from '@youngspe/async-scope';

import { getLogs } from '../_init.ts';

suite('sharedFlow', () => {
  test('basic example', async () => {
    const data = defineFlow<number>(async ({ emit, scope }) => {
      console.log('Starting flow');
      await scope.delay(10);
      await emit(1);

      await scope.delay(10);
      await emit(2);

      await scope.delay(10);
      await emit(3);
      console.log('Ending flow');
    });
    const shared = data.do(share({}));

    await Scope.static.launchAll([
      () =>
        shared.each(async ({ value }) => {
          console.log(`A:${value}`);
        }),
      async ({ scope }) => {
        await scope.delay(15);
        await shared.each(async ({ value }) => {
          console.log(`B:${value}`);
        });
      },
    ]);

    assert.deepEqual(getLogs(), [
      ['Starting flow'],
      ['A:1'],
      ['A:2'],
      ['B:2'],
      ['A:3'],
      ['B:3'],
      ['Ending flow'],
    ]);
  });
});
