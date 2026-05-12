import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { StateFlow } from '@youngspe/async-flows';
import { lifecycle } from '@youngspe/async-flows/ops';
import { Scope, Token } from '@youngspe/async-scope';

import { getLogs } from '../_init.ts';

suite('lifecycle', () => {
  test('basic example', async () => {
    const { set: setState, stateFlow } = StateFlow.createController<'A' | 'B' | 'C' | undefined>();

    const ls = stateFlow.do(lifecycle(['A', 'B', 'C']));

    await Scope.static.launchCancellable(async ({ scope, cancel }) => {
      setState('B');

      const ctrl = Token.createController();

      ls.in(
        {
          A: async ({ token }) => {
            console.log('open A');
            token.add(() => console.log('close A'));
          },
          B: async ({ token }) => {
            console.log('open B');
            token.add(() => console.log('close B'));
          },
          C: async ({ token }) => {
            console.log('open C');
            token.add(() => console.log('close C'));
          },
        },
        { scope: [ctrl] },
      ).catch(cancel);

      await scope.delay(100);
      setState('C');

      await scope.delay(100);
      setState('A');

      await scope.delay(100);
      setState('C');

      await scope.delay(100);
      setState(undefined);

      await ctrl.cancel();
    });

    assert.deepEqual(getLogs(), [
      ['open A'],
      ['open B'],
      ['open C'],
      ['close C'],
      ['close B'],
      ['open B'],
      ['open C'],
      ['close C'],
      ['close B'],
      ['close A'],
    ]);
  });
});
