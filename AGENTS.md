# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`async-utils-js` is a TypeScript monorepo containing asynchronous stream handling primitives inspired by Kotlin Flows. It provides:

- **`@youngspe/async-flows`**: Core Flow abstraction for asynchronous streams of values
- **`@youngspe/async-scope`**: Scope and Token system for managing task lifecycles and cancellation
- **Supporting packages**: Utility packages for iteration, common async functions, Node-specific scope integration

## Architecture

### Monorepo Structure

```
packages/
├── async-flows/          # Core Flow API (defineFlow, flowOf, emptyFlow, toFlow, operators)
├── async-scope/          # Scope and Token for lifecycle management
├── async-scope-common/   # Shared scope concepts between async-scope and node-exit-scope
├── async-iter-utils/     # Iterable/AsyncIterable utilities
├── common-async-utils/   # Common async utilities (Deque, etc.)
├── immediately-resolved/  # Promise utilities for immediately-resolved promises
└── node-exit-scope/      # Node.js-specific scope integration (SIGINT handling, etc.)
```

### Build System

- Uses **pnpm workspace** (workspace root: `/home/youngspe/repos/async-utils-js`)
- TypeScript with `tsgo` for incremental builds
- All packages are ESM modules (`"type": "module"`)

### Key Dependencies (from pnpm catalog)

- `@typescript/native-preview`: Latest TypeScript with native Node.js features
- `eslint`, `prettier`: Code formatting and linting
- `knip`: Static analysis for unused code

## Commands

### Build

```bash
# Build all packages
pnpm run build

# Build a specific package
pnpm -C packages/<package-name> run build
```

### Test

```bash
# Run all tests
pnpm -r run test

# Run tests for a specific package
pnpm -C packages/<package-name> run test

# Run tests with verbose output
pnpm -r run test --verbose
```

### Lint and Format

```bash
# Format code
pnpm run format

# Fix linting issues
pnpm run fix

# Check linting
pnpm run check:lint

# Run all checks (lint + type check)
pnpm run check
```

### Type Check

```bash
# Type check all packages
pnpm run check:tsc
```

### Development Workflow

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build the project:

   ```bash
   pnpm run build
   ```

3. Run tests:

   ```bash
   pnpm -r run test
   ```

4. Make changes and rebuild:

   ```bash
   pnpm run build
   ```

5. Run specific tests:

   ```bash
   # Run all tests in a specific package
   pnpm -C packages/<package-name> run test

   # Run a specific test file
   pnpm -C packages/<package-name> run test --test-path-pattern="<test-file>"
   ```

## Package Details

### `@youngspe/async-flows`

Core Flow API providing stream-like asynchronous iterators.

**Key APIs:**

- `defineFlow<T, R>(({ scope, emit }) => { /* ... */ })`: Create a flow that emits values and returns `R`
- `emptyFlow<R>()`: Create an empty flow that returns `R`
- `flowOf<T>(...items: T[])`: Create a flow from synchronous iterables
- `toFlow<T, TReturn, TNext>(src: ToFlow<T, TReturn, TNext>)`: Convert to a Flow (from async iterables, iterators, etc.)
- `interval(ms)`: Create a timed interval flow
- `sharedFlow({ init: () => { /* ... */ }})`: Share a flow between multiple consumers

**Operators (`@youngspe/async-flows/ops`):**

Syntax:

```typescript
// The following are equivalent:
flow.do(map(/* ... */), filter(/* ... */));
flow.to(map(/* ... */), filter(/* ... */));
flow.pipe(map(/* ... */), filter(/* ... */));
```

- `map(T => U)`, `mapInput(UNext => TNext)`, `mapReturn(TReturn => UReturn)`: Transform each value
- `mapScoped()`, `mapInputScoped()`, `mapReturnScoped()`: Transform each value given a ScopeContext
- `concatAll()`: Concatenate all items yielded by a flow of flow-likes
- `concatMap(T => ToFlow<U>)`: Map each value to a flow-like and concatenate all. Like `map()` + `concatAll()`
- `mergeAll()`: Observe all flow-likes yielded by a nested flow simultaneously and yield them as they come in
- `mergeMap(T => ToFlow<U>)`: Map each value to a flow-like and merge them. Like `map()` + `mergeAll()`
- `take(N)`, `takeWhile(T => Awaitable<boolean>)`: Take N or predicate-based values
- `filter(T => Awaitable<boolean>)`: Filter values
- `collectArray()`: Collect to array
- `collectSet()`: Collect to Set (deduplicated)
- `collectMap()`: Collect key-value pairs to Map
- `associate(V => K)`: Associate keys to values and collect to a `Map<K, V>`
- `drain()`: Drain without yielding values
- `andThen(TReturn => ToFlow<T>)`: Append flow after completion
- `orCatch(error => ToFlow<T>)`: Catch errors and emit recovery flow
- `buffer(N)`: Buffer up to N items while an item is processed and yield each when ready
- `buffers(N)`: Buffer up to N items while an item is processed and yield all buffered items in an array
- `tryMap(T => { continue: U } | { break: B })`: Map with early break support
- `inspect(T => Awaitable<void>)`, `inspectError()`, `inspectStart()`, `inspectFinally()`: Debug helpers
- `shared()`: Share flow between consumers so the flow only executes once at a time

### `@youngspe/async-scope`

Manages task lifecycles and provides cancellation tokens.

**Key Concepts:**

**Scope:** Represents a task with:

- `Scope#launch(fn)`: Run async function with scope context. The scope is closed when the async function is complete.
- `Scope#run(fn)`: Run async function with scope context. The scope stays open until the parent scope is closed.
- `Scope#launchCancellable(fn)`, `Scope#runCancellable(fn)`: Like above, but resolves to `undefined` instead of throwing when cancelled.
- `Scope#token`: Built-in cancellation token
- `Scope#delay(ms)`: Create a delay that can be cancelled
- `Scope#cancel()`: Cancel all children
- `Scope#cancelChildren()`: Cancel specific children
- `Scope#signal`: An AbortSignal that aborts when the scope is closed. Equivalent to `.token.signal`.
- `Scope.static`: A scope that will never be closed and has no resources. Contains `Token.static`.

**Token:** Cancellation token with:

- `Token#add(fn | Cancellable | Cancellable[])`: Add a listener to be notified when the token is cancelled. Returns a Subscription that can be used to cancel the listener
- `Token#signal`: An AbortSignal that aborts when the token is cancelled
- `Token.create(fn)`: Create token with lifecycle hooks
- `Token.createController()`: Create with built-in cancel/pause
- `Token.static`: A "defused" token that will never be cancelled

**Key Types:**

- `ScopeContext`: `{ scope, cancel, token, launch, delay, etc. }`
- `Token`: `{ pause, resume, cancelled }`
- `TokenController`: `{ cancel, token, pause, resume }`

### Supporting Packages

- **`@youngspe/async-scope-common`**: Shared types and utilities between scope packages
- **`@youngspe/async-iter-utils`**: Utilities for async iteration (flatMap, mergeMap, etc.)
- **`@youngspe/common-async-utils`**: Common async utilities including `Deque`
- **`@youngspe/node-exit-scope`**: Node.js-specific scope integration using `signal-exit`

## Code Patterns

### Creating a Flow

```typescript
import { defineFlow } from '@youngspe/async-flows';

const myFlow = defineFlow(async ({ emit, scope }) => {
  await emit(1);
  await scope.delay(1000);
  await emit(2);
  return 'done';
});
```

### Using Scope

```typescript
import { Scope } from '@youngspe/async-scope';

await Scope.static.launch(async ({ scope, cancel }) => {
  await scope
    .launch(async ({ signal }) => {
      const response = await fetch('https://example.com', { signal });
      return response.text();
    })
    .catch(cancel); // Cancel on error
});
```

### Creating a Token

```typescript
import { Token } from '@youngspe/async-scope';

// Create with cancellation callback
const myToken = Token.create({
  init: () => ({
    resume: ({ cancel }) => {
      // Add cancellation logic here
      const handler = () => cancel();
      process.once('SIGINT', handler);
      return { pause: () => process.off('SIGINT', handler) };
    },
  }),
});
```

## Important Notes

- All packages use ESM modules
- Tests use `node --test` runner with `--enable-source-maps`
- Build output is in `dist/` directory of each package
- Test files are excluded from build (`!**/*.test.*`)
- Map files are excluded from package (`!**/*.map`)
- Use `catalog:` prefix for package versions (managed by pnpm)

## Testing

Each package has a `test` script that:

1. Builds the package using the test config
2. Runs Node.js tests on `./dist/**/*.test.js`

To run a specific test:

```bash
pnpm -C packages/<package> run test --test-name-pattern="<test-name>"
```

To run a specific test file:

```bash
pnpm -C packages/<package> run test --test-path-pattern="<path>"
```
