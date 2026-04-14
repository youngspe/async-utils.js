import { isArray, isIterable } from '@youngspe/common-async-utils';

/**
 * Represents an operation that has been cancelled but not necessarily due to a failure.
 */
export class CancellationError extends Error {
  static {
    this.prototype.name = 'CancellationError';
  }

  static override [Symbol.hasInstance](value: unknown) {
    return (
      (value instanceof Error && value.name === this.prototype.name)
      || Function.prototype[Symbol.hasInstance].call(this, value)
    );
  }

  /** An arbitrary value attached to the error */
  value?: unknown;
}

type ToError<T> =
  Error extends T ? Error
  : T extends Error ? T
  : Error;

/**
 * Converts `value` to an {@link Error}.
 * This is intended for use during cancellation, so the fallback type is {@link CancellationError}.
 *
 * @param value - The value to convert.
 * @returns An Error instance. When `value` is:
 * - An {@link Error} instance, `value` itself.
 * - `undefined` or an empty {@link Iterable}, a plain {@link CancellationError}
 * - A `string`, a {@link CancellationError} with `value` as the message.
 * - An {@link Iterable} yielding exactly one item, the output of this function applied to the item
 * - Any other {@link Iterable}, an {@link AggregateError} containing the items with this function
 *   recursively applied to them.
 * - Any other value, a {@link CancellationError} with the {@link CancellationError.value|value} property
 *   set to `value`.
 */
export function toErrorForCancellation<T>(value: T): ToError<T>;
export function toErrorForCancellation(value: unknown): Error {
  const errors = new Set<Error>();
  let isCancellation = true;

  const inner = (value: unknown): Error | undefined => {
    if (value instanceof Error) {
      if (value.name === 'AbortError') {
        if (value.cause !== undefined) return inner(value.cause);

        return new CancellationError(undefined, { cause: value });
      }

      const cancellationError = unwrapCancellationError(value);
      if (cancellationError) return cancellationError;

      isCancellation = false;
      return value;
    }
    if (value === undefined) return;
    if (typeof value === 'string') return new CancellationError(value);

    if (isIterable(value)) {
      for (const item of value) {
        const ret = inner(item);
        if (ret) {
          errors.add(ret);
        }
      }
      return;
    }

    let msg: string | undefined;

    if (typeof value === 'function') {
      msg = value.name;
    } else if (
      value === null
      || typeof value !== 'object'
      || (typeof value.toString === 'function' && value.toString !== Object.prototype.toString)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      msg = String(value);
    }

    return Object.assign(new CancellationError(msg), { value });
  };

  let error = inner(value);
  if (error) return error;

  if (errors.size > 1)
    return isCancellation ?
        new CancellationError(undefined, { cause: new AggregateError(errors) })
      : new AggregateError(errors);

  [error] = errors;
  return error ?? new CancellationError();
}

/**
 * Combines an iterator of errors into a single value.
 *
 * @param errors
 * @returns
 * - if `errors` contains zero non-`undefined` items, `undefined`.
 * - if `errors` contains exactly one distinct non-undefined value, that value.
 * - otherwise, an {@link AggregateError} of the items in `errors`, after removing `undefined` values and duplicates.
 */
export function combineErrors(errors: Iterable<unknown>): unknown {
  if (isArray(errors) && errors.length <= 1) return errors[0];

  const errorSet = errors instanceof Set ? errors : new Set(errors);

  errorSet.delete(undefined);

  if (errorSet.size <= 1) {
    const [error] = errorSet.values();
    return error;
  }

  return new AggregateError(errorSet);
}

export function unwrapCancellationError(error: unknown): CancellationError | undefined {
  while (true) {
    if (error instanceof CancellationError) return error;
    if (!(error instanceof Error)) return undefined;
    error = error.cause;
  }
}
