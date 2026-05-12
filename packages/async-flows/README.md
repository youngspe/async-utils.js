# `@youngspe/async-flows`

Inspired by [Kotlin Flows](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow/), a `Flow` is an asynchronous stream of values.

[@youngspe/async-scope](https://www.npmjs.com/package/@youngspe/async-scope) is used to manage the lifecycle of flows and flow handlers.

## Creating a flow

### `defineFlow`

```typescript
import { defineFlow } from '@youngspe/async-flows';

const flow = defineFlow<number, string>(async ({ scope, emit }) => {
  await emit(1);
  await scope.delay(1000);

  await emit(2);
  await scope.delay(1000);

  await emit(3);
  await scope.delay(1000);

  return 'hello';
});

const out = await flow.each(({ value }) => {
  console.log(value);
});

console.log(out);

// Output:
// 1
// 2
// 3
// hello
```

### `emptyFlow`

```typescript
import { emptyFlow } from '@youngspe/async-flows';

const flow = emptyFlow();

await flow.each(({ value }) => {
  console.log(value);
});

// No output
```

#### With a return value:

```typescript
import { emptyFlow } from '@youngspe/async-flows';

const flow = emptyFlow('hello');

const out = await flow.each(({ value }) => {
  console.log(value);
});

console.log(out);

// Output:
// hello
```

### `flowOf`

```typescript
const flow = flowOf(1, 2, 3);

await flow.each(({ value }) => {
  console.log(value);
});

// Output:
// 1
// 2
// 3
```

### `toFlow`

#### From an iterable

```typescript
import { toFlow } from '@youngspe/async-flows';

const flow = toFlow([1, 2, 3]);

await flow.each(({ value }) => {
  console.log(value);
});

// Output:
// 1
// 2
// 3
```

#### From an async iterable

```typescript
import { toFlow } from '@youngspe/async-flows';

const flow = toFlow<number, string>(
  (async function* () {
    yield 1;
    yield 2;
    yield 3;
    return 'hello';
  })(),
);

const out = await flow.each(({ value }) => {
  console.log(value);
});

console.log(out);

// Output:
// 1
// 2
// 3
// hello
```

## Operators

The `@youngspe/async-flows/ops` module contains operators for transforming or combining flows. Operators can be passed to the `do`/`to`/`pipe` methods of a Flow.

See [`operators.md`](./operators.md)
