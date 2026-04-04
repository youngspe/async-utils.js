import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { Immediate, immediate, loop } from './index.ts';
import { verifyNotComplete, verifySettled } from './util.test.ts';

suite('loop', () => {
  test('should resolve immediately', async () => {
    const out = loop(
      ({ i, sum }) =>
        immediate(function* (_await) {
          if (i === 0) return { break: sum };
          i--;
          sum = yield* _await(Immediate.resolve(sum + i));
          return { continue: { i, sum } };
        }),
      { i: 10, sum: 0 },
    );

    verifySettled(out);

    assert.equal(await out, 45);
  });
  test('should not resolve immediately', async () => {
    const out = loop(
      ({ i, sum }) =>
        immediate(function* (_await) {
          if (i === 0) return { break: sum };
          i--;
          sum = yield* _await(Promise.resolve(sum + i));
          return { continue: { i, sum } };
        }),
      { i: 10, sum: 0 },
    );

    verifyNotComplete(out);

    assert.equal(await out, 45);
  });
});
