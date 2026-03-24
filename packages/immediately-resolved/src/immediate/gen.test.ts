import { test, suite } from 'node:test';
import { immediate } from './gen.ts';
import assert from 'node:assert/strict';
import { Immediate } from '../immediate.ts';

suite('immediate', () => {
  suite('should resolve immediately', () => {
    test('when a non-promise-like value is awaited', async () => {
      const out = immediate(function* (_await) {
        const x = yield* _await(123);
        return x + 7;
      });

      assert(out.isComplete());
      assert(!out.isRejected());
      assert(out.isResolved());
      assert.equal(out.value, 130);
      const x: number = await out;
      assert.equal(x, out.value);
    });

    test('when a resolved Immediate is awaited', async () => {
      const out = immediate(function* (_await) {
        const x = yield* _await(Immediate.resolve(123));
        return x + 7;
      });

      assert(out.isComplete());
      assert(!out.isRejected());
      assert(out.isResolved());
      assert.equal(out.value, 130);
      const x: number = await out;
      assert.equal(x, out.value);
    });
  });

  suite('should not resolve immediately', () => {
    test('when a promise is awaited', async () => {
      const out = immediate(function* (_await) {
        const x = yield* _await(Promise.resolve(123));
        return x + 7;
      });

      assert(!out.isComplete());
      assert(!out.isResolved());
      assert(!out.isRejected());
      const x: number = await out;
      assert.equal(out.value, 130);
      assert.equal(x, out.value);
    });

    test('when a pending Immediate is awaited', async () => {
      const out = immediate(function* (_await) {
        const x = yield* _await(Immediate.resolve(Promise.resolve(123)));
        return x + 7;
      });

      assert(!out.isSettled());
      assert(!out.isResolved());
      assert(!out.isRejected());
      const x: number = await out;
      assert.equal(out.value, 130);
      assert.equal(x, out.value);
    });
  });
});
