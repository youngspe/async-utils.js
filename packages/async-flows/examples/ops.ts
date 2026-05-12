/* eslint-disable @typescript-eslint/no-unsafe-return */
import { test, suite, mock, beforeEach, afterEach, type Mock } from 'node:test';
import assert from 'node:assert/strict';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';

import { defineFlow, flowOf, StateFlow, type Flow } from '@youngspe/async-flows';
import {
  andThen,
  associate,
  buffer,
  buffers,
  collectArray,
  collectMap,
  collectSet,
  drain,
  filter,
  concatMap,
  mergeAll,
  inspect,
  inspectComplete,
  inspectError,
  inspectFinally,
  inspectScoped,
  inspectStart,
  map,
  orCatch,
  share,
  take,
  takeWhile,
  tryMap,
  lifecycle,
} from '@youngspe/async-flows/ops';
import { Scope, Token } from '@youngspe/async-scope';

let log!: Mock<(...args: any) => void>;
useFakeTimers();

beforeEach(() => {
  log = mock.method(console, 'log');
  log.mock.mockImplementation(() => {});
});
afterEach(() => {
  mock.restoreAll();
});

suite('map', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);

    const doubleFlow = flow.do(map(value => value * 2));

    await doubleFlow.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 2
    // 4
    // 6

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[2], [4], [6]],
    );
  });
});

suite('concatMap', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);

    const flowWithRepeats = flow.do(
      concatMap(value =>
        defineFlow<number>(async ({ emit }) => {
          for (let i = 0; i < value; ++i) {
            await emit(value);
          }
        }),
      ),
    );

    await flowWithRepeats.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 2
    // 3
    // 3
    // 3

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [2], [3], [3], [3]],
    );
  });
});

suite('mergeAll', () => {
  test('basic examples', async () => {
    const flow = defineFlow<Flow<string>>(async ({ scope, emit }) => {
      await emit(
        defineFlow(async ({ scope, emit }) => {
          await scope.delay(200);

          // 200ms
          await emit('a1');

          await scope.delay(30);

          // 230ms
          await emit('a2');
        }),
      );

      await scope.delay(50);

      await emit(
        defineFlow(async ({ scope, emit }) => {
          await scope.delay(50);

          // 100ms
          await emit('b1');

          await scope.delay(60);

          // 160ms
          await emit('b2');

          await scope.delay(50);

          // 210ms
          await emit('b3');
        }),
      );

      await scope.delay(30);

      await emit(
        defineFlow(async ({ scope, emit }) => {
          await scope.delay(40);

          // 120ms
          await emit('c1');

          await scope.delay(50);

          // 170ms
          await emit('c2');

          await scope.delay(10);

          // 180ms
          await emit('c3');

          await scope.delay(60);

          // 240ms
          await emit('c4');
        }),
      );
    });

    const merged = flow.do(mergeAll());

    await merged.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // b1
    // c1
    // b2
    // c2
    // c3
    // a1
    // b3
    // a2
    // c4

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['b1'], ['c1'], ['b2'], ['c2'], ['c3'], ['a1'], ['b3'], ['a2'], ['c4']],
    );
  });
});

suite('andThen', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3);

    const appended = numbers.do(andThen(() => [4, 5, 6]));

    await appended.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 3
    // 4
    // 5
    // 6

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [3], [4], [5], [6]],
    );
  });
});

suite('orCatch', () => {
  test('basic example', async () => {
    const failingFlow = defineFlow(async ({ emitAll }) => {
      await emitAll([1, 2, 3]);
      throw new Error('Oh no!');
    });

    const recovered = failingFlow.do(
      orCatch(() => {
        return [4, 5, 6];
      }),
    );

    await recovered.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 3
    // 4
    // 5
    // 6

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [3], [4], [5], [6]],
    );
  });
});

suite('buffer', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10).do(
      inspectScoped(async ({ value, scope }) => {
        if (value % 5 === 0) {
          await scope.delay(100);
        }
        console.log('Emitting:', value);
      }),
    );
    const buffered = flow.do(buffer(3));

    await buffered.each(async ({ value, scope }) => {
      console.log(value);
      await scope.delay(10);
    });

    // Output:
    // Emitting: 1
    // 1
    // Emitting: 2
    // Emitting: 3
    // Emitting: 4
    // 2
    // 3
    // 4
    // Emitting: 5
    // 5
    // Emitting: 6
    // Emitting: 7
    // Emitting: 8
    // 6
    // Emitting: 9
    // 7
    // 8
    // 9
    // Emitting: 10
    // 10

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [
        ['Emitting:', 1],
        [1],
        ['Emitting:', 2],
        ['Emitting:', 3],
        ['Emitting:', 4],
        [2],
        [3],
        [4],
        ['Emitting:', 5],
        [5],
        ['Emitting:', 6],
        ['Emitting:', 7],
        ['Emitting:', 8],
        [6],
        ['Emitting:', 9],
        [7],
        [8],
        [9],
        ['Emitting:', 10],
        [10],
      ],
    );
  });
});

suite('buffers', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const buffered = flow.do(buffers(3));

    await buffered.each(async ({ value, scope }) => {
      console.log(...value);
      await scope.delay(10);
    });

    // Output:
    // 1
    // 2 3 4
    // 5 6 7
    // 8 9 10

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2, 3, 4], [5, 6, 7], [8, 9, 10]],
    );
  });
});

suite('take', () => {
  test('take N values', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const firstFive = numbers.do(take(5));

    await firstFive.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 3
    // 4
    // 5

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [3], [4], [5]],
    );
  });
});

suite('takeWhile', () => {
  test('basic example', async () => {
    const evens = flowOf(1, 2, 3, 4, 5, 6, 7, 8).do(takeWhile(n => n < 5));

    await evens.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 1
    // 2
    // 3
    // 4

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [3], [4]],
    );
  });
});

suite('filter', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const evens = numbers.do(filter(n => n % 2 === 0));

    await evens.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 2
    // 4
    // 6
    // 8
    // 10

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[2], [4], [6], [8], [10]],
    );
  });
});

suite('collectArray', () => {
  test('basic example', async () => {
    const array = await flowOf(1, 2, 3).do(collectArray());

    console.log(array);

    // Output:
    // [1, 2, 3]

    assert.deepEqual(array, [1, 2, 3]);
  });
});

suite('collectSet', () => {
  test('basic example', async () => {
    const set = await flowOf(1, 2, 2, 3, 3, 3).do(collectSet());

    console.log(Array.from(set));

    // Output:
    // [1, 2, 3]

    assert.deepEqual(Array.from(set), [1, 2, 3]);
  });
});

suite('collectMap', () => {
  test('basic example', async () => {
    const keyed = await flowOf<[string, number]>(['a', 1], ['b', 2], ['c', 3]).do(collectMap());

    console.log(Array.from(keyed));

    // Output:
    // [['a' => 1], ['b' => 2], ['c' => 3]]

    assert.deepEqual(Array.from(keyed), [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });
});

suite('associate', () => {
  test('basic example', async () => {
    const indexed = await flowOf(10, 20, 30).do(associate(async n => `key-${n}`));

    console.log(Array.from(indexed));

    // Output:
    // ['key-10' => 10, 'key-20' => 20, 'key-30' => 30]

    assert.deepEqual(Array.from(indexed), [
      ['key-10', 10],
      ['key-20', 20],
      ['key-30', 30],
    ]);
  });
});

suite('drain', () => {
  test('basic example', async () => {
    const cleanup = defineFlow(async ({ emit }) => {
      console.log(1);
      await emit(1);

      console.log(2);
      await emit(2);

      console.log(3);
      await emit(3);

      return 'done';
    });

    const drained = await cleanup.do(drain());

    console.log(drained);

    // Output:
    // 1
    // 2
    // 3
    // done

    assert.equal(drained, 'done');
    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[1], [2], [3], ['done']],
    );
  });
});

suite('inspect', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3);

    const logged = numbers.do(inspect(value => console.log('Value:', value)));

    await logged.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // Value: 1
    // 1
    // Value: 2
    // 2
    // Value: 3
    // 3

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['Value:', 1], [1], ['Value:', 2], [2], ['Value:', 3], [3]],
    );
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

    // Output:
    // Error: Test error

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['Error: Test error']],
    );
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

    // Output:
    // Starting...
    // 1
    // 2
    // 3
    // Done!

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['Starting...'], [1], [2], [3], ['Done!']],
    );
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

    // Output:
    // Finally: success

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['Finally:', 'success']],
    );
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

    // Output:
    // Caught Error: Test error

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['Caught', 'Error: Test error']],
    );
  });
});

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

    // Output:
    // Starting flow
    // A:1
    // A:2
    // B:2
    // A:3
    // B:3
    // Ending flow

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [['Starting flow'], ['A:1'], ['A:2'], ['B:2'], ['A:3'], ['B:3'], ['Ending flow']],
    );
  });
});

suite('tryMap', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5);

    const mapped = numbers.do(
      tryMap(n => {
        if (n === 4) return { break: undefined };
        return { continue: n * 2 };
      }),
    );

    await mapped.each(({ value }) => {
      console.log(value);
    });

    // Output:
    // 2
    // 4
    // 6

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [[2], [4], [6]],
    );
  });
});

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

    // Output:
    // open A
    // open B
    // open C
    // close C
    // close B
    // open B
    // open C
    // close C
    // close B
    // close A

    assert.deepEqual(
      log.mock.calls.map(c => c.arguments),
      [
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
      ],
    );
  });
});
