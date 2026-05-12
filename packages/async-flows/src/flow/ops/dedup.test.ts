import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { defineFlow, type Flow } from '../../flow.ts';
import { inspect } from './inspect.ts';
import { dedup, dedupByKey } from './dedup.ts';
import { map } from './transform.ts';

useFakeTimers();

async function baseDedupTest<T = string>(
  getFlow: (f: Flow<string, undefined, unknown>) => Flow<T>,
  each: (value: T) => string,
) {
  const log: Array<['recv' | 'close' | 'emit', string]> = [];

  const srcFlow = defineFlow<'a' | 'b' | 'c'>(async ({ emit, scope }) => {
    await emit('a');
    await scope.delay(10);
    await emit('b');
    await emit('c');
    await scope.delay(10);
    await emit('c');
    await scope.delay(10);
    await emit('a');
    await scope.delay(10);
    await emit('c');
    await scope.delay(10);
    await emit('b');
    await scope.delay(10);
    await emit('b');
    await emit('b');
    await emit('a');
    await emit('b');
    await scope.delay(10);
    await emit('a');
    await emit('a');
  }).do(
    inspect(s => {
      log.push(['emit', s]);
    }),
  );

  const f = getFlow(srcFlow);

  const expected = [
    ['emit', 'a'],
    ['recv', 'a'],
    ['emit', 'b'],
    ['close', 'a'],
    ['recv', 'b'],
    ['emit', 'c'],
    ['close', 'b'],
    ['recv', 'c'],
    ['emit', 'c'],
    ['emit', 'a'],
    ['close', 'c'],
    ['recv', 'a'],
    ['emit', 'c'],
    ['close', 'a'],
    ['recv', 'c'],
    ['emit', 'b'],
    ['close', 'c'],
    ['recv', 'b'],
    ['emit', 'b'],
    ['emit', 'b'],
    ['emit', 'a'],
    ['close', 'b'],
    ['recv', 'a'],
    ['emit', 'b'],
    ['close', 'a'],
    ['recv', 'b'],
    ['emit', 'a'],
    ['close', 'b'],
    ['recv', 'a'],
    ['emit', 'a'],
    ['close', 'a'],
  ] satisfies typeof log;

  await f.each(({ value, scope }) => {
    const mapped = each(value);
    log.push(['recv', mapped]);
    scope.token.add(() => {
      log.push(['close', mapped]);
    });
  });

  assert.deepEqual(log, expected);
}

suite('dedup', () => {
  test('verify order of events', async () => {
    await baseDedupTest(dedup(), x => x);
  });
});

suite('dedupByKey', () => {
  test('verify order of events', async () => {
    await baseDedupTest(
      f =>
        f.do(
          map(value => ({ value })),
          dedupByKey(x => x.value),
        ),
      x => x.value,
    );
  });
});
