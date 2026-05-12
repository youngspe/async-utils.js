/**
 * Symbols used by this library.
 * @module
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Cancellable } from './cancel.ts';

/**
 * Used to indicate whether a cancellable will be affected by cancellation.
 * @see {@link Cancellable[cancellableActive]}
 */
export const cancellableAdding = Symbol.for('async-scope.cancellable-active');
/**
 * @see {@link Cancellable[cancellableAdded]}
 */
export const cancellableAdded = Symbol.for('async-scope.cancellable-added');
/**
 * @see {@link Cancellable[cancellableRemoved]}
 */
export const cancellableRemoved = Symbol.for('async-scope.cancellable-removed');
