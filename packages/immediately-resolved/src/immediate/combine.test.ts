import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import timers from 'node:timers/promises';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';
import { TypeAssert } from '@private/test-utils/type-assert';

import { Immediate, type EvaluationKind } from 'immediately-resolved';
import { verifyComplete, verifyNotComplete } from '../util.test.ts';

useFakeTimers();

suite('Immediate', () => {
  suite('.all', () => {
    suite('resolves immediately', () => {
      test('with an empty array', async () => {
        const target = Immediate.all([]);

        verifyComplete(target);
        assert(!target.isRejected());
        assert.deepEqual(target.value, []);

        const out = await target;
        assert.deepEqual(out, target.value);
      });

      test('with an array of non-promise-like values', async () => {
        const target = Immediate.all([1, 2, 3]);

        verifyComplete(target);
        assert(!target.isRejected());
        assert.deepEqual(target.value, [1, 2, 3]);

        const out = await target;
        assert.deepEqual(out, target.value);
      });

      test('with an empty object', async () => {
        const target = Immediate.all({});

        verifyComplete(target);
        assert(!target.isRejected());
        assert.deepEqual(target.value, {});

        const out = await target;
        assert.deepEqual(out, target.value);
      });

      test('with an object of non-promise-like values', async () => {
        const target = Immediate.all({ a: 1, b: 2, c: 3 } as const);

        verifyComplete(target);
        assert(!target.isRejected());
        assert.deepEqual(target.value, { a: 1, b: 2, c: 3 });

        const out = await target;
        assert.deepEqual(out, target.value);
      });
    });

    suite('does not resolve immediately', () => {
      test('with an array containing a promise-like value', async () => {
        const target = Immediate.all([1, Promise.resolve(2), 3] as const);

        verifyNotComplete(target);
        const out = await target;

        assert.deepEqual(target.value, [1, 2, 3]);
        assert.deepEqual(out, target.value);
      });

      test('with an object containing a promise-like value', async () => {
        const target = Immediate.all({ a: 1, b: Promise.resolve(2), c: 3 });

        verifyNotComplete(target);
        const out = await target;

        assert.deepEqual(target.value, { a: 1, b: 2, c: 3 });
        assert.deepEqual(out, target.value);
      });
    });
  });

  suite('.any', () => {
    test('resolves with the first resolved promise', async () => {
      const target = Immediate.any([
        timers.setTimeout(50, 1),
        timers.setTimeout(30, 2),
        timers.setTimeout(70, 3),
      ]);

      verifyNotComplete(target);

      assert.equal(await target, 2);
    });

    test('resolves immediately with the first non-promise', async () => {
      const target = Immediate.any([
        timers.setTimeout(50, 1),
        timers.setTimeout(30, 2),
        3,
        timers.setTimeout(70, 4),
        5,
      ]);

      TypeAssert(_ => _.Variable({ target }).Not.Extends<Immediate<any, EvaluationKind.Sync>>);

      assert(target.isResolved());

      assert.equal(await target, 3);
    });
  });

  suite('.race', () => {
    test('resolves with the first resolved promise', async () => {
      const target = Immediate.race([
        timers.setTimeout(50, 1),
        timers.setTimeout(30, 2),
        timers.setTimeout(70, 3),
      ]);

      verifyNotComplete(target);

      assert.equal(await target, 2);
    });

    test('resolves immediately with the first non-promise', async () => {
      const target = Immediate.race([
        timers.setTimeout(50, 1),
        timers.setTimeout(30, 2),
        3,
        timers.setTimeout(70, 4),
        5,
      ]);

      verifyComplete(target);

      assert.equal(await target, 3);
    });
  });
});
