import type { Awaitable, Falsy, OptionalUndefinedParams } from './types.ts';
import { isIterable, isPromiseLike } from './utils.ts';

type Operation<T, U> =
  | ((value: T, index: number) => Awaitable<U>)
  | ([T] extends [U] ? null | undefined : never);

export async function joinPromises<T, U = T, Out = never, Out2 = never>(
  src: Iterable<Awaitable<T>> | AsyncIterable<T>,
  ...[operation, onResolve, onReject]: OptionalUndefinedParams<
    [
      operation: Operation<T, U>,
      onResolve: ((value: U, index: number) => Awaitable<Out | Falsy>) | null | undefined,
      onReject: ((reason: unknown, index: number) => Awaitable<Out2 | Falsy>) | null | undefined,
    ]
  >
): Promise<NonNullable<Out | Out2> | undefined> {
  return new Promise<NonNullable<Out | Out2> | undefined>((_resolve, _reject) => {
    let done = false;
    let count = 1;

    const resolve = (value: Out | Out2 | Falsy) => {
      if (value || --count === 0) {
        done = true;
        _resolve(value || undefined);
      }
    };
    const reject = (e: unknown) => ((done = true), _reject(e));

    const processItem = async (_value: Awaitable<T>, index: number) => {
      try {
        if (done) return;
        let awaited;

        try {
          const value = isPromiseLike(_value) ? await _value : _value;

          if (operation) {
            if (done) return;
            const ret = operation(value, index);
            awaited = isPromiseLike(ret) ? await ret : ret;
            if (done) return;
          } else {
            awaited = value as T & U;
          }
        } catch (e) {
          if (!onReject) return reject(e);
          if (done) return;
          return resolve(await onReject(e, index));
        }

        return resolve(await onResolve?.(awaited, index));
      } catch (e) {
        return reject(e);
      }
    };

    void (async () => {
      try {
        let i = 0;

        if (isIterable(src)) {
          for (const item of src) {
            ++count;
            void processItem(item, i++);
            if (done) break;
          }
        } else {
          for await (const item of src) {
            ++count;
            void processItem(item, i++);
            if (done) break;
          }
        }

        return resolve(undefined);
      } catch (e) {
        return reject(e);
      }
    })();
  });
}

/**
 * Like `Promise.allSettled()`, this waits until all promises have settled. Like `Promise.all()`, this rejects if any promise rejects.
 */
export async function whenAllSettled<T, U = T, Out = never>(
  src: Iterable<Awaitable<T>> | AsyncIterable<T>,
  ...[operation, onResolve]: OptionalUndefinedParams<
    [
      operation: Operation<T, U>,
      onResolve: ((value: U, index: number) => Awaitable<Out | Falsy>) | null | undefined,
    ]
  >
): Promise<Out | undefined> {
  const errors = new Set<unknown>();

  const out = await joinPromises(src, operation!, onResolve, e => void errors.add(e));

  if (out !== undefined) return out;

  if (errors.size > 1) throw new AggregateError(errors);
  if (errors.size === 1) throw errors.values().next().value;
}
