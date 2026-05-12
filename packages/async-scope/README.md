# `@youngspe/async-scope`

## Concepts

### Scope

A Scope represents the lifecycle and resources associated with an asynchronous task. It includes a Token to signal cancellation and methods to facilitate creating new subtasks.

```typescript
import { Scope } from '@youngspe/async-scope';

const scope = Scope.static;

await scope.launch(async ({ scope, cancel }) => {
  const responsePromise = scope
    .launch(async ({ signal }) => {
      const response = await fetch('https://example.com/foo', { signal });
      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`);
      }
      return await response.text();
    })
    // If the subtask rejects, call cancel to end the parent task:
    .catch(cancel);

  // Wait at least 1 second before showing the response.
  // If the request fails before the time has elapsed the delay will be cancelled.
  await scope.delay(1_000);

  console.log(await responsePromise);
});
```

### Token

A Token (as in <dfn>cancellation token</dfn>) signals when a task should be cancelled.
Each Scope has a `token` property representing the lifecycle of its task.

#### Example: creating a token with lifecycle callbacks

```typescript
import { Token } from '@youngspe/async-scope';
// This token is cancelled when ctrl-c is pressed.
const sigintToken = Token.create({
  init: () => ({
    resume: ({ cancel }) => {
      const handler = () => cancel();
      // When the first cancellable is added, add the event listener:
      process.once('SIGINT', handler);
      return {
        pause: () => {
          // When the last cancellable is removed, remove the event listener:
          process.off('SIGINT', handler);
        },
      };
    },
  }),
});
```

#### Example: create a token with a TokenController

```typescript
import { Token, Scope } from '@youngspe/async-scope';

/** Returns a token that cancels after the given number of milliseconds. */
function timeoutToken(ms: number): Token {
  const { cancel, token } = Token.createController();
  setTimeout(cancel, ms);
  return token;
}
```
