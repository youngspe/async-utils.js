export type Awaitable<T> = T | Promise<T> | PromiseLike<T>;

export type Falsy = false | null | undefined | 0 | 0n | '';

type _OptionalUndefinedParams<A extends any[], R extends any[]> =
  { [K in keyof R]: undefined } extends R ?
    A extends [...infer L, ...R] ?
      [...L, ...Partial<R>]
    : A
  : R extends [any, ...infer Rest] ? _OptionalUndefinedParams<A, Rest>
  : A;

export type OptionalUndefinedParams<A extends any[]> = _OptionalUndefinedParams<A, A>;

type SimplifyObject<T> = { [K in keyof T]: T[K] };

type AssumeSubtype<Super, Sub> = Sub extends infer _Sub extends Super ? Sub : never;
type CheckSubtype<Super, Sub extends Super> = Sub;

/**
 * Makes properties of `T` that may be `undefined` optional.
 * Useful for a params/options object for a function when a value might not be required depending
 * on the type parameters.
 *
 * @example
 *
 * interface MyParams<T, U> {
 *   items: T[]
 *   // This property may be undefined if a `T` is already a valid `U`, but
 *   // as-is you'll still need to include `transform: undefined` in your options.
 *   transform: ((value: T) => U) | (T extends U ? undefined : never);
 * }
 *
 * function myMap<T, U = T>({
 *   items,
 *   transform,
 * }: OptionalUndefinedProps<MyParams<T, U>>): U[] {
 *   return transform ? items.map(transform) : items as (T & U)[]
 * }
 *
 * const strings = myMap({
 *   items: [1, 2, 3],
 *   transform: String,
 * }); // ['1', '2', '3']
 *
 * // `transform` is not required because `T` and `U` are both `number`.
 * const unchanged = myMap({ items: [1, 2, 3] }); // [1, 2, 3]
 */
export type OptionalUndefinedProps<T> =
  | T
  | { [K in keyof (Partial<T> & { [K in keyof T as undefined extends T[K] ? never : K]: any })]: T[K] };

/** Evaluates to `T`, unless `T` is never, in which case it evaluates to `Else`. */
export type UnlessNeverElse<T, Else> = [T] extends [never] ? Else : T;

/** Evaluates to `Then` if `T` is `never`, otherwise `Else`. */
export type IfNever<T, Then, Else> =
  | (T extends any ? Else : never)
  | (Then & ([T] extends [never] ? unknown : never));

/**
 * Evaluates to `never` if `T` is `never`, otherwise `U`.
 *
 * @example
 *
 * // This type may or may not contain an error value of type `E`:
 * type State<E> = Ready | Failed<E>;
 * type Ready = { status: 'ready', value: number }
 * // When `E` is `never`, `Failed<E>` is also never thanks to `OrNever<E>`:
 * type Failed<E> = { status: 'failed'; error: E } & OrNever<E>;
 *
 * // This means when `E` is `never`, the type `State<never>` evaluates to
 * // `Ready` to correctly reflect that it can never be in the `Failed` state.
 *
 * // Given a function with this signature:
 * function createState<E>(): State<E> {
 *   return { value: 0 }
 * }
 *
 * // The following operation is valid because we have specified there will
 * // never be an error:
 * const { value } = createState<never>();
 */
export type OrNever<T, U = unknown> = IfNever<T, never, U>;
