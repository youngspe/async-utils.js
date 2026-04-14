import type { Falsy } from '../types.ts';

export interface SubscriptionLifecycle<Init extends any[] = [], Resume extends any[] = []> {
  init?: ((this: void, ...args: Init) => SubscriptionLifecycle.Initialized<Resume> | void) | undefined;
  dispose?: ((this: void) => void) | undefined;
}
export namespace SubscriptionLifecycle {
  export interface Initialized<Resume extends any[] = []> {
    resume?: ((this: void, ...args: Resume) => Resumed | void) | undefined;
    close?: ((this: void) => void) | undefined;
  }

  export interface Resumed {
    pause?: ((this: void) => void) | undefined;
  }
}
export class SubscriptionLifecycleManager<
  Init extends any[] = [],
  Resume extends any[] = [],
> implements SubscriptionLifecycle<Init, Resume> {
  #lifecycle?: SubscriptionLifecycle<Init, Resume> | undefined;
  #init?: SubscriptionLifecycleManagerInit<Resume> | undefined;

  constructor(lifecycle?: SubscriptionLifecycle<Init, Resume>) {
    this.#lifecycle = lifecycle || {};
  }

  init = (...args: Init) => {
    return (this.#init ??= new SubscriptionLifecycleManagerInit(
      this.#lifecycle?.init?.(...args),
      () => (this.#init = undefined),
    ));
  };

  pause = () => {
    this.#init?.pause();
  };

  close = () => {
    try {
      this.pause();
    } finally {
      const init = this.#init;
      this.#init = undefined;
      init?.close?.();
    }
  };

  dispose = () => {
    try {
      this.close();
    } finally {
      const lifecycle = this.#lifecycle;
      this.#lifecycle = undefined;

      lifecycle?.dispose?.();
    }
  };

  [Symbol.dispose] = this.dispose;
}
class SubscriptionLifecycleManagerInit<Resume extends any[] = []>
  implements SubscriptionLifecycle.Initialized
{
  #init?: SubscriptionLifecycle.Initialized<Resume> | undefined;
  #resumed?: SubscriptionLifecycleManagerResume | undefined;
  #onClose;

  constructor(init?: SubscriptionLifecycle.Initialized<Resume> | void, onClose?: (this: void) => void) {
    this.#init = init || {};
    this.#onClose = onClose;
  }

  resume = (...args: Resume) => {
    return (this.#resumed ??= new SubscriptionLifecycleManagerResume(
      this.#init?.resume?.(...args),
      () => (this.#resumed = undefined),
    ));
  };

  pause = () => {
    this.#resumed?.pause();
  };

  close = () => {
    const onClose = this.#onClose;
    this.#onClose = undefined;

    try {
      try {
        this.pause();
      } finally {
        const init = this.#init;
        this.#init = undefined;
        init?.close?.();
      }
    } finally {
      onClose?.();
    }
  };

  [Symbol.dispose] = this.close;
}
class SubscriptionLifecycleManagerResume implements SubscriptionLifecycle.Resumed {
  #resumed?: SubscriptionLifecycle.Resumed | undefined;
  #onPause;
  constructor(resumed?: SubscriptionLifecycle.Resumed | void, onPause?: (this: void) => void) {
    this.#resumed = resumed || {};
    this.#onPause = onPause;
  }

  pause = () => {
    const resumed = this.#resumed;
    const onPause = this.#onPause;
    this.#resumed = this.#onPause = undefined;
    try {
      resumed?.pause?.();
    } finally {
      onPause?.();
    }
  };

  [Symbol.dispose] = this.pause;
}

export abstract class Subscription {
  get isActive(): boolean {
    return false;
  }
  dispose() {}
  pause() {}
  resume() {}
  [Symbol.dispose]() {
    this.dispose();
  }

  static readonly noop = Object.freeze(new (class NoopSubscription extends this {})());

  static fromDispose(this: void, dispose: (() => void) | undefined) {
    if (!dispose) return Subscription.noop;
    return new DisposeSubscription(dispose);
  }

  static fromLifecycle(
    this: void,
    lifecycle:
      | (SubscriptionLifecycle<[], [initializing: boolean]> & {
          isActive?: ((this: void) => boolean) | undefined;
          paused?: boolean | undefined;
        })
      | (() => SubscriptionLifecycle.Initialized<[initializing: boolean]>)
      | undefined,
  ): Subscription {
    if (!lifecycle) return Subscription.noop;
    return new LifecycleSubscription(lifecycle);
  }

  static collect(this: void, subscriptions: Iterable<Subscription | Falsy>): Subscription {
    const set = new Set<Subscription>();

    for (const sub of subscriptions) {
      if (sub && sub.isActive) {
        set.add(sub);
      }
    }

    if (set.size > 1) return new SubscriptionSet(set);
    const [sub] = set;

    return sub ?? Subscription.noop;
  }
}
class DisposeSubscription extends Subscription {
  #dispose;

  constructor(dispose?: (this: void) => void) {
    super();
    this.#dispose = dispose;
  }

  override get isActive() {
    return !!this.#dispose;
  }

  override dispose() {
    const dispose = this.#dispose;
    this.#dispose = undefined;
    dispose?.();
  }
}
class LifecycleSubscription extends Subscription {
  #lifecycle: SubscriptionLifecycleManager<[], [first: boolean]> | undefined;
  #initialized: SubscriptionLifecycleManagerInit<[first: boolean]> | undefined;
  #isActive;

  constructor(
    lifecycle?:
      | (SubscriptionLifecycle<[], [first: boolean]> & {
          isActive?: ((this: void) => boolean) | undefined;
          paused?: boolean | undefined;
        })
      | (() => SubscriptionLifecycle.Initialized<[first: boolean]> | void),
  ) {
    super();
    let paused = false;

    if (typeof lifecycle !== 'function') {
      this.#isActive = lifecycle?.isActive;
      paused = lifecycle?.paused ?? false;
    }

    this.#lifecycle =
      lifecycle
      && new SubscriptionLifecycleManager(
        typeof lifecycle === 'function' ? { init: lifecycle } : lifecycle,
      );
    this.#initialized = this.#lifecycle?.init();
    if (!paused) {
      this.#initialized?.resume(true);
    }
  }

  override resume(): void {
    this.#initialized?.resume(false);
  }

  override pause(): void {
    this.#lifecycle?.pause();
  }

  override dispose() {
    const lifecycle = this.#lifecycle;
    this.#lifecycle = this.#initialized = this.#isActive = undefined;
    lifecycle?.dispose();
  }

  override get isActive() {
    return !!this.#lifecycle && this.#isActive?.() !== false;
  }
}

class SubscriptionSet extends Subscription {
  #items;
  constructor(items: Set<Subscription>) {
    super();
    this.#items = items;
  }

  #forEach(action?: (item: Subscription) => void) {
    const errors = new Set();
    for (const item of this.#items) {
      if (!item.isActive) {
        this.#items.delete(item);
        continue;
      }

      try {
        action?.(item);
      } catch (e) {
        errors.add(e);
      }

      if (errors.size > 1) throw new AggregateError(errors);
      if (errors.size === 1) throw errors.values().next().value;
    }
  }

  override pause(): void {
    this.#forEach(item => item.pause());
  }

  override resume(): void {
    this.#forEach(item => item.resume());
  }

  override dispose(): void {
    this.#forEach(item => item.dispose());
  }

  override get isActive() {
    this.#forEach();
    return !!this.#items.size;
  }
}
