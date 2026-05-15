import { Subscription, Token, type CancellableOptions } from '@youngspe/async-scope';
import { type StandardLifecycle, standardLifecycleController } from '#pkg/lifecycle';

/**
 * Options for the {@link LifecycleCounter} constructor.
 */
export interface LifecycleCounterOptions extends CancellableOptions {
  /**
   * Determines when the `'created'` state begins:
   *
   * - `'immediately'`: the `'created'` state begins immediately.
   * - `'firstAdded'`: the `'created'` state begins when the first handle is added.
   * - `'started'`: the `'created'` state follows the same rule as the `'started'` state.
   *
   * @default `'immediately'`
   */
  createWhen?: 'immediately' | 'firstAdded' | 'started' | undefined;
  /**
   * Determines when the `'started'` state begins:
   *
   * - `'firstAdded'`: the `'started'` state begins when the first handle is added.
   * - `'firstResumed'`: the `'started'` state begins when the first handle is resumed.
   *
   * @default `'firstResumed'`
   */
  startWhen?: 'firstAdded' | 'firstResumed' | undefined;
  /**
   * Determines when the `'started'` state ends:
   *
   * - `'lastRemoved'`: the `'started'` state ends when all handles have been removed.
   *   It will begin again when the {@linkcode startWhen}
   *   conditions are met.
   * - `'never'`: the `'started'` state ends only after the provided {@link scope} or {@link token}
   *   ends if present.
   *
   * @default `'never'`
   */
  stopWhen?: 'lastRemoved' | 'never' | undefined;
}

/**
 * Controls a {@link StandardLifecycle} such that the lifecycle state is determined by the handles
 * added to this object by calling {@link LifecycleCounter#add}.
 *
 * If at least one handle is resumed, the lifecycle will be in the `'resumed'` state.
 * Otherwise, the `'created'` and `'started'` states' behavior are determined by
 * {@linkcode LifecycleCounterOptions#createWhen},
 * {@linkcode LifecycleCounterOptions#startWhen}, and
 * {@linkcode LifecycleCounterOptions#stopWhen}.
 */
export class LifecycleCounter {
  readonly #setState;
  readonly lifecycle: StandardLifecycle<never>;
  #initCount = 0;
  #resumedCount = 0;
  #token;
  #createWhen;
  #startWhen;
  #stopWhen;

  constructor(options?: LifecycleCounterOptions) {
    const token = options && Token.from(options);
    const { createWhen = 'immediately', startWhen = 'firstResumed', stopWhen = 'never' } = options ?? {};
    this.#createWhen = createWhen;
    this.#startWhen = startWhen;
    this.#stopWhen = stopWhen;
    const { setState, lifecycle } = standardLifecycleController<never>({ token });
    this.#token = token;
    this.#setState = setState;
    this.lifecycle = lifecycle;

    if (createWhen === 'immediately') {
      void setState('created');
    }
  }

  /**
   * Adds a handle to the counter.
   * If at least one handle is resumed (either manually or created non-paused), the lifecycle enters
   * the `'resumed'` state.
   */
  add(options?: CancellableOptions & { paused?: boolean | undefined }): Subscription {
    const stateOnAdd =
      this.#startWhen === 'firstAdded' ? 'started'
      : this.#createWhen === 'firstAdded' ? 'created'
      : undefined;

    const stateOnRemove = this.#stopWhen === 'lastRemoved' ? 'created' : undefined;

    return Subscription.fromLifecycle({
      paused: options?.paused,
      init: () => {
        if (this.#initCount++ === 0 && stateOnAdd) {
          void this.#setState(stateOnAdd);
        }

        return {
          resume: () => {
            if (this.#resumedCount++ === 0) {
              void this.#setState('resumed');
            }

            return {
              pause: () => {
                if (--this.#resumedCount === 0) {
                  void this.#setState('started');
                }
              },
            };
          },
          close: () => {
            if (--this.#initCount === 0 && stateOnRemove) {
              void this.#setState(stateOnRemove);
            }
          },
        };
      },
      token: Token.from([this.#token, options]),
    });
  }
}
