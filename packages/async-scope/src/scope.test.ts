import { suite, test } from 'node:test';
import assert from 'node:assert/strict';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { Scope } from './scope.ts';
import { delay } from './timers.ts';
import { Token } from './token.ts';
import { ResourceKey } from './scopedResource.ts';

suite('Scope', () => {
  const { clock } = useFakeTimers();

  suite('.static', () => {
    suite('#run', () => {
      test('returns the correct result', async () => {
        const scope = Scope.static;

        const out = await scope.launch(async () => 'foo');

        assert.equal(out, 'foo');
      });

      test('rejects if cancelled early', async () => {
        const error = new Error('foo');

        const ctrl = Token.createController();

        await Promise.all([
          delay(5).then(() => ctrl.cancel(error)),
          assert.rejects(
            () => Scope.static.launch(async () => delay(10).then(() => 'foo'), { token: ctrl.token }),
            error,
          ),
        ]);

        assert.equal(clock().now, 5);
      });
    });
  });

  suite('resources', () => {
    const fooResource = ResourceKey.create<string>('foo');
    const barResource = ResourceKey.create<string>('bar');

    test('access a resource', async () => {
      const scope = Scope.static.withResources(r => r.put(fooResource, 'foo1'));

      const out = await scope.launch(({ resources }) => resources.get({ fooResource }));

      assert.deepEqual(out, { fooResource: 'foo1' });
    });

    test('override a resource', async () => {
      const scope = Scope.static.withResources(r => r.put(fooResource, 'foo1').put(barResource, 'bar1'));

      const out = await scope.launch(async ({ scope }) => {
        const out = await scope
          .withResources(r => r.put(fooResource, 'foo2'))
          .launch(({ resources }) => resources.get({ fooResource, barResource }));

        assert.deepEqual(out, { fooResource: 'foo2', barResource: 'bar1' });

        return scope.resources.get({ fooResource, barResource });
      });

      assert.deepEqual(out, { fooResource: 'foo1', barResource: 'bar1' });
    });

    const fooDisposableResource = ResourceKey.create<AsyncDisposable>();
    const barDisposableResource = ResourceKey.create<AsyncDisposable>();

    test('resources get disposed', async () => {
      const ctrl = Token.createController();
      const events: number[] = [];
      const cleanup = (ms: number) => ({
        [Symbol.asyncDispose]: () => delay(ms).then(() => void events.push(ms)),
      });

      const scope = Scope.from(ctrl).withResources(r =>
        r.put(fooDisposableResource, cleanup(6)).put(barDisposableResource, cleanup(5)),
      );

      await scope.launch(({ scope }) => {
        scope.withResources(r => r.put(fooDisposableResource, cleanup(7)));
      });

      assert.equal(clock().now, 7);

      await ctrl.cancel();

      assert.equal(clock().now, 13);
      assert.deepEqual(events, [7, 5, 6]);
    });
  });

  suite('#launchAll', () => {
    test('with an object of tasks', async ({ signal }) => {
      const scope = Scope.from(signal);

      const out = await scope.launchAll({
        foo: async ({ scope }) => {
          await scope.delay(100);
          return 1;
        },
        bar: async ({ scope }) => {
          await scope.delay(300);
          return 2;
        },
        baz: async ({ scope }) => {
          await scope.delay(200);
          return 3;
        },
      });

      assert.deepEqual(out, { foo: 1, bar: 2, baz: 3 });
    });
  });
});
