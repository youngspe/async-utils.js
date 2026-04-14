/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { Awaitable, UnlessNeverElse } from './types.ts';

/**
 * Gets the base {@link Iterable} types for each constituent of union type `I` that is an iterable.
 * Discards all non-iterable constituents.
 *
 * This is a helper for {@linkcode AsIterable}.
 */
type ExtractIterable<I> = I extends Iterable<infer X, infer Y, infer Z> ? Iterable<X, Y, Z> : never;

/**
 * If `I` or any of its union constituents extend {@link Iterable}, evaluates to the base iterable
 * type of `I` or its constituents.
 * Otherwise, evaluates to {@linkcode Iterable|Iterable<unknown, unknown, any>}.
 *
 * This is used in the predicate type of {@linkcode isIterable} to narrow a type down to
 * {@link Iterable} while preserving the most likely `yield`, `return`, and `next` types.
 */
type AsIterable<I> =
  Iterable<unknown, unknown, any> extends I ? Iterable<unknown, unknown, any> : ExtractIterable<I>;

export function isIterable<T>(value: T | ExtractIterable<T> | null | undefined): value is AsIterable<T>;
export function isIterable(value: any) {
  return typeof value?.[Symbol.iterator] === 'function';
}
/**
 * Gets the base {@link Iterable} types for each constituent of union type `I` that is an iterable.
 * Discards all non-iterable constituents.
 *
 * This is a helper for {@linkcode AsIterable}.
 */
type ExtractAsyncIterable<I> = I extends Iterable<infer X, infer Y, infer Z> ? Iterable<X, Y, Z> : never;

/**
 * If `I` or any of its union constituents extend {@link Iterable}, evaluates to the base iterable
 * type of `I` or its constituents.
 * Otherwise, evaluates to {@linkcode Iterable|Iterable<unknown, unknown, any>}.
 *
 * This is used in the predicate type of {@linkcode isIterable} to narrow a type down to
 * {@link Iterable} while preserving the most likely `yield`, `return`, and `next` types.
 */
type AsAsyncIterable<I> = UnlessNeverElse<ExtractAsyncIterable<I>, AsyncIterable<unknown, unknown, any>>;

export function isAsyncIterable<T>(
  value: T | AsAsyncIterable<T> | null | undefined,
): value is AsAsyncIterable<T>;
export function isAsyncIterable(value: any) {
  return typeof value?.[Symbol.asyncIterator] === 'function';
}

export function isPromiseLike<T>(value: Awaitable<T> | null | undefined): value is PromiseLike<T>;
export function isPromiseLike(
  value: Awaitable<NonNullable<unknown> | null | undefined>,
): value is PromiseLike<unknown>;
export function isPromiseLike(value: any) {
  return typeof value?.then === 'function';
}

/** @returns `true` if `value` has a {@linkcode Symbol.dispose} method. */
export function isDisposable(value: unknown): value is Disposable;
export function isDisposable(value: any) {
  return typeof value?.[Symbol.dispose] === 'function';
}

/** @returns `true` if `value` has a {@linkcode Symbol.asyncDispose} method. */
export function isAsyncDisposable(value: unknown): value is AsyncDisposable;
export function isAsyncDisposable(value: any) {
  return typeof value?.[Symbol.asyncDispose] === 'function';
}

/**
 * Gets the base {@link Array} types for each constituent of union type `I` that is an array.
 * Discards all non-array constituents.
 *
 * This is a helper for {@linkcode AsArray}.
 */
type ExtractArray<I> =
  I extends Array<infer X> ? X[]
  : I extends ReadonlyArray<infer X> ? readonly X[]
  : I extends Iterable<infer X> ? X[]
  : never;

/**
 * If `I` or any of its union constituents extend {@link Array} or {@link ReadonlyArray}, evaluates
 * to the base array type of `I` or its constituents.
 * Otherwise, evaluates to `unknown[]`.
 *
 * This is used in the predicate type of {@linkcode isArray} to narrow a type down to {@link Array}
 * while preserving the most likely element type.
 */
type AsArray<I> = unknown[] extends I ? unknown[] : ExtractArray<I>;

interface IsArrayFunction {
  <I>(value: I | ExtractArray<I> | null | undefined): value is AsArray<I>;
}

/**
 * @returns `true` if {@link value} is an array.
 *
 * @remarks
 * This is an alias for {@link Array.isArray} but the types work out better for readonly arrays.
 */
export const isArray = Array.isArray.bind(Array) as IsArrayFunction;
