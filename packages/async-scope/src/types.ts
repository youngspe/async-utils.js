/**
 * A value that yields `T` when awaited. Useful for functions that take either the value itself or a
 * promise that yields it.
 */
export type Awaitable<T> = T | Promise<T> | PromiseLike<T>;

/**
 * A value that's treated like `false` in conditional operations like `if` or `&&`
 *
 * More permissive APIs may accept falsy values and treat them as empty or undefined.
 *
 * @example
 * interface Node { value: number }
 *
 * const nodes: Node[] = [];
 *
 * function addNode(node: Node | Falsy) {
 *   if (node) {
 *     nodes.push(node);
 *   }
 * }
 *
 * // Generate some nodes:
 * const exampleNodes = [-2,1,4,-6,-3,-2,5].map(value => ({ value }));
 *
 * // Add only the nodes with a positive value.
 * // When the value is negative, `node.value > 0 && node` will evaluate to `false`.
 * exampleNodes.forEach(node => addNode(node.value > 0 && node));
 *
 */
export type Falsy = false | null | undefined | 0 | 0n | '';

/** If `--exactOptionalProperties` is enabled, evaluates to `Then`. Otherwise `Else`. */
export type IfExactOptionalPropertiesEnabled<Then, Else> =
  { x: undefined } extends { x?: never } ? Else : Then;

/** Evalutes to `Then` if `T` is `never`, otherwise `Else`. */
type IfNever<T, Then, Else> =
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

/** Evaluates to `T`, unless `T` is never, in which case it evaluates to `Else`. */
export type UnlessNeverElse<T, Else> = [T] extends [never] ? Else : T;
