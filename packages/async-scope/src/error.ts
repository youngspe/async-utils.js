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
}

type ToError<T> = T extends Error ? T : Error;

export function toError<T>(value: T): ToError<T>;
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value === undefined) return new CancellationError();
  if (typeof value === 'string') return new Error(value);
  if (Array.isArray(value)) return new AggregateError(value.map(toError));
  if (typeof value === 'function') return new Error(value.name);

  let msg = undefined;

  if (typeof value !== 'function' && (value === null || typeof value !== 'object')) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    msg = String(value);
  }

  return Object.assign(new Error(msg), { value });
}
