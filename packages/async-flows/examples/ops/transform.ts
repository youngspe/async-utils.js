import { test, suite } from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow, flowOf, type Flow } from '@youngspe/async-flows';
import {
  defined,
  discardInput,
  filter,
  map,
  concatMap,
  mapInput,
  mapInputScoped,
  mapReturn,
  mapReturnScoped,
  mapScoped,
  mergeAll,
  drain,
} from '@youngspe/async-flows/ops';

import { getLogs } from '../_init.ts';

suite('map', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3);

    const doubleFlow = flow.do(map(value => value * 2));

    await doubleFlow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6]]);
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

    assert.deepEqual(getLogs(), [[1], [2], [2], [3], [3], [3]]);
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

    assert.deepEqual(getLogs(), [['b1'], ['c1'], ['b2'], ['c2'], ['c3'], ['a1'], ['b3'], ['a2'], ['c4']]);
  });
});

suite('filter', () => {
  test('basic example', async () => {
    const numbers = flowOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    const evens = numbers.do(filter(n => n % 2 === 0));

    await evens.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6], [8], [10]]);
  });
});

suite('mapScoped', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3).do(mapScoped(async ({ value }) => value * 2));

    await flow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[2], [4], [6]]);
  });
});

suite('mapInput', () => {
  test('basic example', async () => {
    const flow = defineFlow<void, undefined, number>(async ({ emit }) => {
      console.log(await emit());
      console.log(await emit());
      console.log(await emit());
    });

    const inputMapped = flow.do(mapInput(async value => value * 10));

    let i = 1;

    await inputMapped.each(() => {
      return i++;
    });

    // Output:
    // 10
    // 20
    // 30

    assert.deepEqual(getLogs(), [[10], [20], [30]]);
  });
});

suite('mapInputScoped', () => {
  test('basic example', async () => {
    const flow = defineFlow<void, undefined, number>(async ({ emit }) => {
      console.log(await emit());
      console.log(await emit());
      console.log(await emit());
    });

    const inputMapped = flow.do(mapInputScoped(async ({ value }) => value * 10));

    let i = 1;

    await inputMapped.each(() => {
      return i++;
    });

    // Output:
    // 10
    // 20
    // 30

    assert.deepEqual(getLogs(), [[10], [20], [30]]);
  });
});

suite('mapReturn', () => {
  test('basic example', async () => {
    const result = await defineFlow(async ({ emit }) => {
      await emit(1);
      return 'original';
    })
      .do(mapReturn(value => value.toUpperCase()))
      .do(drain());

    console.log(result);

    assert.equal(result, 'ORIGINAL');
  });
});

suite('mapReturnScoped', () => {
  test('basic example', async () => {
    const result = await defineFlow(async ({ emit }) => {
      await emit(1);
      return 42;
    })
      .do(mapReturnScoped(async ({ value }) => value * 2))
      .do(drain());

    console.log(result);

    assert.equal(result, 84);
  });
});

suite('discardInput', () => {
  test('basic example', async () => {
    const flow = flowOf(1, 2, 3).do(discardInput());

    await flow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [3]]);
  });
});

suite('defined', () => {
  test('basic example', async () => {
    const flow = flowOf(1, undefined, 2, undefined, 3).do(defined());

    await flow.each(({ value }) => {
      console.log(value);
    });

    assert.deepEqual(getLogs(), [[1], [2], [3]]);
  });
});
