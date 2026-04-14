import type { OptionalUndefinedProps } from '@youngspe/common-async-utils';

export type { Awaitable } from '@youngspe/async-scope-common';
export type { OptionalUndefinedParams, OptionalUndefinedProps } from '@youngspe/common-async-utils';

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

export type PartialOrUndefined<T> = IfExactOptionalPropertiesEnabled<
  { [P in keyof T]?: T[P] | undefined },
  Partial<T>
>;

type EraseProps<T> = { [K in keyof T]: any };

export type Defined<T = unknown> = NonNullable<T> | (T & null);

export type UpdateObject<T, U> =
  T extends Partial<U> ? T & U
  : U extends never ? never
  : {
      [K in keyof (EraseProps<T> & EraseProps<OptionalUndefinedProps<U>>)]: K extends keyof U ?
        Extract<PropertyKey, K> extends never ?
          Defined<U[K]> | (undefined extends U[K] ? T[K & keyof T] : never)
        : T[K & keyof T] | U[K & keyof T]
      : T[K & keyof T];
    };

export type SetProps<T, U> =
  T extends Partial<U> ? T & U
  : U extends never ? never
  : U & {
      [K in keyof T as Exclude<K, keyof (EraseProps<T> | EraseProps<U>)>]: U extends Record<K, any> ? U[K]
      : U extends Partial<Record<K, infer X>> ? Extract<X, U[K]> | T[K & keyof T]
      : T[K & keyof T];
    };

export type BetterOmit<T, K extends PropertyKey> =
  T extends never ? never : { [_K in keyof T as Exclude<_K, K>]: T[_K] };

export type UndefinedIfDefault<T, Def = object> = T | (Def extends T ? undefined : never);
