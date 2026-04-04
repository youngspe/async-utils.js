import { Immediate, type ImmediateInput } from '../immediate.ts';
import type { ImmediateState } from '../state.ts';
import { isPromiseLike } from '../util.ts';

export const allIterable = <T>(values: Iterable<ImmediateInput<T>>): Immediate<T[]> =>
  new Immediate((resolve, reject) => {
    /**
     * As each task is complete, assign its respective index in this array.
     * Once all tasks are complete, resolve with this value.
     *
     * The array will automatically size to fit whatever index is assigned, so once the last item
     * in `values` is complete, this array will have the correct length.
     */
    const outValues: Partial<T[]> = [];

    /**
     * Number of pending tasks.
     * Start at one instead of zero so we don't resolve too early.
     *
     * Essentially, the loop over `values` is itself a pending task.
     */
    let pendingCount = 1;

    let i = 0;

    for (const item of values) {
      const idx = i++;

      if (Immediate.isImmediate(item)) {
        if (item.isRejected()) throw item.error;

        if (item.isResolved()) {
          outValues[idx] = item.value;
          continue;
        }
      }

      if (isPromiseLike(item)) {
        ++pendingCount;

        item.then(value => {
          outValues[idx] = value;

          if (--pendingCount === 0) {
            resolve(outValues as T[]);
          }
        }, reject);

        continue;
      }

      outValues[idx] = item;
    }

    /**
     * Decrement to signal the "loop over `values`" task has ended.
     *
     * If there are no pending tasks left, resolve the promise.
     */
    if (--pendingCount === 0) {
      resolve(outValues as T[]);
    }
  });

export const allObject = <T>(values: Record<string, ImmediateInput<T>>): Immediate<Record<string, T>> =>
  new Immediate((resolve, reject) => {
    /**
     * As each task is complete, assign its respective index in this array.
     * Once all tasks are complete, resolve with this value.
     *
     * The array will automatically size to fit whatever index is assigned, so once the last item
     * in `values` is complete, this array will have the correct length.
     */
    const outValues: Partial<Record<string, T>> = {};

    /**
     * Number of pending tasks.
     * Start at one instead of zero so we don't resolve too early.
     *
     * Essentially, the loop over `values` is itself a pending task.
     */
    let pendingCount = 1;

    for (const [idx, item] of Object.entries(values)) {
      if (Immediate.isImmediate(item)) {
        if (item.isRejected()) throw item.error;

        if (item.isResolved()) {
          outValues[idx] = item.value;
          continue;
        }
      }

      if (isPromiseLike(item)) {
        ++pendingCount;

        item.then(value => {
          outValues[idx] = value;

          if (--pendingCount === 0) {
            resolve(outValues as Record<string, T>);
          }
        }, reject);

        continue;
      }

      outValues[idx] = item;
    }

    /**
     * Decrement to signal the "loop over `values`" task has ended.
     *
     * If there are no pending tasks left, resolve the promise.
     */
    if (--pendingCount === 0) {
      resolve(outValues as Record<string, T>);
    }
  });

export const any = <T>(values: Iterable<ImmediateInput<T>> | readonly ImmediateInput<T>[]) => {
  if (values instanceof Array) {
    if (values.length === 1) return Immediate.resolve(values[0]!);
    if (values.length === 0) return Immediate.NEVER;
  }

  return new Immediate((resolve, reject) => {
    let pendingCount = 1;
    const errors: unknown[] = [];

    let i = 0;

    for (const item of values) {
      const idx = i++;

      if (item instanceof Immediate) {
        if (item.isRejected()) {
          errors[idx] = item;
          continue;
        }

        if (item.isResolved()) return resolve(item.value);
      }

      if (isPromiseLike(item)) {
        ++pendingCount;

        item.then(resolve, error => {
          errors[idx] = error;

          if (--pendingCount === 0) {
            reject(errors);
          }
        });

        continue;
      }

      return resolve(item);
    }

    /**
     * Decrement to signal the "loop over `values`" task has ended.
     *
     * If there are no pending tasks left, reject the promise.
     */
    if (--pendingCount === 0) {
      reject(errors);
    }
  });
};

export const race = <T, S extends ImmediateState>(
  values: Iterable<ImmediateInput<T, S>> | readonly ImmediateInput<T, S>[],
) => {
  if (values instanceof Array) {
    if (values.length === 1) return Immediate.resolve<T, S>(values[0]!);
    if (values.length === 0) return Immediate.NEVER as Immediate<never, S>;
  }

  return new Immediate((resolve, reject) => {
    let i = 0;
    let lastItem: PromiseLike<T> | undefined;

    for (const item of values) {
      ++i;
      if (item instanceof Immediate) {
        if (item.isResolved() || (item.isRejected() && !isPromiseLike(item.error))) return resolve(item);
      }

      lastItem?.then(resolve, reject);
      lastItem = undefined;

      if (isPromiseLike(item)) {
        lastItem = item;
        continue;
      }

      return resolve(item);
    }

    if (i === 1 && lastItem) return resolve(lastItem);
    if (i === 0) return resolve(Immediate.NEVER as Immediate<T>);

    lastItem?.then(resolve, reject);
  }) as Immediate<T, S>;
};

export const allSettledIterable = <T, S extends ImmediateState.Initial>(
  values: Iterable<ImmediateInput<T, S>>,
): Immediate<PromiseSettledResult<T>[], S> =>
  new Immediate(resolve => {
    /**
     * As each task is complete, assign its respective index in this array.
     * Once all tasks are complete, resolve with this value.
     *
     * The array will automatically size to fit whatever index is assigned, so once the last item
     * in `values` is complete, this array will have the correct length.
     */
    const outValues: Partial<PromiseSettledResult<T>[]> = [];

    /**
     * Number of pending tasks.
     * Start at one instead of zero so we don't resolve too early.
     *
     * Essentially, the loop over `values` is itself a pending task.
     */
    let pendingCount = 1;

    let i = 0;

    for (const item of values) {
      const idx = i++;

      if (Immediate.isImmediate(item)) {
        if (item.isRejected()) {
          outValues[idx] = { status: 'rejected', reason: item.error };
          continue;
        }

        if (item.isResolved()) {
          outValues[idx] = { status: 'fulfilled', value: item.value };
          continue;
        }
      }

      if (isPromiseLike(item)) {
        ++pendingCount;

        item.then(
          value => {
            outValues[idx] = { status: 'fulfilled', value };

            if (--pendingCount === 0) {
              resolve(outValues as PromiseSettledResult<T>[]);
            }
          },
          (reason: unknown) => {
            outValues[idx] = { status: 'rejected', reason };

            if (--pendingCount === 0) {
              resolve(outValues as PromiseSettledResult<T>[]);
            }
          },
        );

        continue;
      }

      outValues[idx] = { status: 'fulfilled', value: item };
    }

    /**
     * Decrement to signal the "loop over `values`" task has ended.
     *
     * If there are no pending tasks left, resolve the promise.
     */
    if (--pendingCount === 0) {
      resolve(outValues as PromiseSettledResult<T>[]);
    }
  }) as Immediate<PromiseSettledResult<T>[], S>;
