# Operators

## Examples

### `map()`

Transforms each value yielded by the flow.

```ts
import { flowOf } from '@youngspe/async-flows';
import { map } from '@youngspe/async-flows/ops';

const flow = flowOf(1, 2, 3);

const doubleFlow = flow.do(map(value => value * 2));

await doubleFlow.each(({ value }) => {
  console.log(value);
});

// Output:
// 2
// 4
// 6
```

### `concatMap()`

Maps each value yielded by the flow into a flow-like value, from which all values will be emitted. Equivalent to `map()` followed by `concatAll()`.

```ts
import { defineFlow, flowOf } from '@youngspe/async-flows';
import { concatMap } from '@youngspe/async-flows/ops';

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
```

### `mergeAll()`

Interleave all items from the flow-likes yielded by this stream.

```ts
import { defineFlow, type Flow } from '@youngspe/async-flows';
import { mergeAll } from '@youngspe/async-flows/ops';

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
```

### `andThen()`

After all values from the original flow have been emitted, calls the given function and yields all
values from the resulting flow-like.

```ts
import { flowOf } from '@youngspe/async-flows';
import { andThen } from '@youngspe/async-flows/ops';

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
```

### `orCatch()`

If the flow completes with an error, calls the given function and yields all values from the
resulting flow-like.

```ts
import { defineFlow } from '@youngspe/async-flows';
import { orCatch } from '@youngspe/async-flows/ops';

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
```

### `buffer()`

While a handler is running asynchronously, continues receiving up to the given number of items from
the original flow and yields that when the current handler is complete.
This prevents blocking the flow's producer if the flow's consumer sometimes takes too long to handle
a yielded item.

```ts
import { flowOf } from '@youngspe/async-flows';
import { buffer } from '@youngspe/async-flows/ops';

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
```

In the above example, `1` is yielded immediately.
While the handler for `1` is running, the next three values `2`, `3`, and `4` are buffered and then
yielded after the handler for `1` is complete.
Because there is a 100ms pause before `5` is emitted, the handler has time to catch up and empty
the buffer.

Buffering begins again while the handler for `5` is running, so `6`, `7`, and `8` are buffered.
After the handler for `6` is complete, there's room in the buffer for the next value `9` from the
original flow.
The three buffered items are emitted, and the 100ms delay before `10` is emitted means the buffer will be empty by then.

### `buffers()`

While a handler is running asynchronously, continue receiving up to the given number of items from
the original flow.
The buffered items are yielded at once in an array.

A value is yielded immediately if available, so the first item is always a single-element array.

```ts
import { flowOf } from '@youngspe/async-flows';
import { buffers } from '@youngspe/async-flows/ops';

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
```

In the above example, the value `1` is emitted in its own array as soon as it's received.
While the handler for `1` is running, the next three items `2`, `3`, and `4` from the original flow are buffered.
These items are emitted in a single array after the `1` handler is complete, and the next three items are buffered while the new handler is running. This continues until the original flow is complete.

### `take()`

Takes only the first N values from the flow.

```ts
import { flowOf } from '@youngspe/async-flows';
import { take } from '@youngspe/async-flows/ops';

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
```

### `takeWhile()`

Takes values from the flow while the provided predicate returns true.

```ts
import { flowOf } from '@youngspe/async-flows';
import { takeWhile } from '@youngspe/async-flows/ops';

const evens = flowOf(1, 2, 3, 4, 5, 6, 7, 8).do(takeWhile(n => n < 5));

await evens.each(({ value }) => {
  console.log(value);
});

// Output:
// 1
// 2
// 3
// 4
```

### `filter()`

Filters values from the flow based on a predicate.

```ts
import { flowOf } from '@youngspe/async-flows';
import { filter } from '@youngspe/async-flows/ops';

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
```

### `collectArray()`

Collects all values yielded by the flow into an array.

```ts
import { flowOf } from '@youngspe/async-flows';
import { collectArray } from '@youngspe/async-flows/ops';

const array = await flowOf(1, 2, 3).do(collectArray());

console.log(array);

// Output:
// [1, 2, 3]
```

### `collectSet()`

Collects all values yielded by the flow into a Set, removing duplicates.

```ts
import { flowOf } from '@youngspe/async-flows';
import { collectSet } from '@youngspe/async-flows/ops';

const set = await flowOf(1, 2, 2, 3, 3, 3).do(collectSet());

console.log(Array.from(set));

// Output:
// [1, 2, 3]
```

### `collectMap()`

Collects a flow of key-value pairs into a Map.

```ts
import { flowOf } from '@youngspe/async-flows';
import { collectMap } from '@youngspe/async-flows/ops';

const keyed = await flowOf<[string, number]>(['a', 1], ['b', 2], ['c', 3]).do(collectMap());

console.log(Array.from(keyed));

// Output:
// [['a', 1], ['b', 2], ['c', 3]]
```

### `associate()`

Similar to `collectMap()`, but instead of operating on key-value pairs, a function is called to get the key for each item.

```ts
import { flowOf } from '@youngspe/async-flows';
import { associate } from '@youngspe/async-flows/ops';

const indexed = await flowOf(10, 20, 30).do(associate(async n => `key-${n}`));

console.log(Array.from(indexed));

// Output:
// [['key-10', 10], ['key-20', 20], ['key-30', 30]]
```

### `drain()`

Observes the flow and discards all yielded values.
Resolves to the return value of the flow.

```ts
import { defineFlow } from '@youngspe/async-flows';
import { drain } from '@youngspe/async-flows/ops';

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
```

### `inspect()`

Calls the given function for each item when the flow is observed.

```ts
import { flowOf } from '@youngspe/async-flows';
import { inspect } from '@youngspe/async-flows/ops';

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
```

### `inspectError()`

Calls the given function when the flow encounters an error.

```ts
import { defineFlow } from '@youngspe/async-flows';
import { inspectError } from '@youngspe/async-flows/ops';

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
```

### `inspectStart()`

Calls the given function at the start of the flow, before any values are emitted.

```ts
import { flowOf } from '@youngspe/async-flows';
import { inspectStart } from '@youngspe/async-flows/ops';

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
```

### `inspectFinally()`

Calls the given function at the end of the flow, regardless of whether it completed successfully or with an error.

```ts
import { flowOf } from '@youngspe/async-flows';
import { inspectFinally } from '@youngspe/async-flows/ops';

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
```

### `inspectFinally()` with error

```ts
import { defineFlow } from '@youngspe/async-flows';
import { inspectError } from '@youngspe/async-flows/ops';

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
```

### `sharedFlow()`

Shares a flow instance between multiple consumers.
The flow is started (or restarted) when a consumer is added (e.g. by calling `each()`) and cancelled when all consumers are cancelled.

```ts
import { defineFlow, Scope } from '@youngspe/async-flows';
import { share } from '@youngspe/async-flows/ops';

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
```

### `tryMap()`

Maps values from the flow using a function that returns either `ControlFlow.Continue` (proceeds to next value) or `ControlFlow.Break` (stops emitting).

```ts
import { flowOf } from '@youngspe/async-flows';
import { tryMap } from '@youngspe/async-flows/ops';

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
```

### `lifecycle()`

Creates a `Lifecycle` that gets its current state from the flow.

```ts
import { Scope, Token } from '@youngspe/async-scope';
import { StateFlow } from '@youngspe/async-flows';
import { lifecycle } from '@youngspe/async-flows/ops';

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
```
