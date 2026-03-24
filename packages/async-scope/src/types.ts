export type Awaitable<T> = T | Promise<T> | PromiseLike<T>;
export type Falsy = false | null | undefined | 0 | 0n | '';
export type IfExactOptionalPropertiesEnabled<Then, Else> =
  { x: undefined } extends { x?: never } ? Else : Then;
type IfNever<T, Then, Else> =
  | (T extends any ? Else : never)
  | (Then & ([T] extends [never] ? unknown : never));

export type OrNever<T, U = unknown> = IfNever<T, never, U>;
type IfNever<T, Then, Else> =
  | (T extends any ? Else : never)
  | (Then & ([T] extends [never] ? unknown : never));

export type OrNever<T, U = unknown> = IfNever<T, never, U>;
