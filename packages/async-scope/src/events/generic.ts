import type { OptionalUndefinedProps } from '../types.ts';
import { type SubscriptionLifecycle, SubscriptionLifecycleManager, Subscription } from './sub.ts';

export interface EventListenerKey {}

export type MaybePromise<T, Async extends boolean> = T | (Async extends true ? Promise<T> : never);

export type Awaitable<T> = T | Promise<T> | PromiseLike<T>;

interface Handler<T, Ret> {
  key: EventListenerKey;
  listener?: ((this: void, value: T) => Ret) | undefined;
  dispose?: ((this: void) => void) | undefined;
  once: boolean;
  paused: boolean;
}

export interface ListenerSet<T, Ret> extends Disposable {
  get isEmpty(): boolean;
  listeners(): Generator<(value: T) => Ret, void, void>;
  listenersReversed(): Generator<(value: T) => Ret, void, void>;
  call(value: T): Generator<Ret, void, void>;
  callReversed(value: T): Generator<Ret, void, void>;
  popFront(): ((value: T) => Ret) | undefined;
  popBack(): ((value: T) => Ret) | undefined;
}

interface ListenerSetParams {
  onRemove?: ((this: void, handler: Handler<never, unknown>) => void) | undefined;
  onDispose?: ((this: void) => void) | undefined;
}

function wrapListener<T, Ret>(listener: (value: T) => Ret): (value: T) => Ret {
  let _listener: typeof listener | undefined = listener;
  let out: Ret | undefined;

  return value => {
    const l = _listener;
    _listener = undefined;

    if (l) {
      out = l(value);
    }

    return out!;
  };
}

class ListenerSetImpl<T, Ret> implements ListenerSet<T, Ret> {
  #handlers: Handler<T, Ret>[] | undefined;
  #onRemove: ((this: void, handler: Handler<never, unknown>) => void) | undefined;
  #onDispose: ((this: void) => void) | undefined;
  #released = false;

  private constructor(
    handlers: Handler<T, Ret>[] | undefined,
    onRemove: ((this: void, handler: Handler<never, unknown>) => void) | undefined,
    onDispose: ((this: void) => void) | undefined,
  ) {
    this.#handlers = handlers;
    this.#onRemove = onRemove;
    this.#onDispose = onDispose;
  }

  static create<T, Ret>(
    handlers: Handler<T, Ret>[] | undefined,
    { onRemove, onDispose }: ListenerSetParams,
  ) {
    return new ListenerSetImpl(
      handlers?.filter(h => !h.paused),
      onRemove,
      onDispose,
    );
  }

  static readonly EMPTY = new this<unknown, never>(undefined, undefined, undefined);

  get isEmpty() {
    return !this.#handlers?.length;
  }

  #removeIfNeeded(handler: Handler<never, unknown>) {
    if (handler.once) {
      const { dispose } = handler;
      handler.listener = handler.dispose = undefined;
      this.#onRemove?.call(undefined, handler);
      dispose?.();
    }
  }

  #cleanupHandlersIfNeeded() {
    if (this.#handlers?.length) return;
    this.#handlers = this.#onRemove = undefined;
  }

  *listeners() {
    let listener;

    while ((listener = this.popFront())) {
      yield listener;
    }
  }

  *listenersReversed() {
    let listener;

    while ((listener = this.popBack())) {
      yield listener;
    }
  }

  *call(value: T) {
    let listener;

    while ((listener = this.popFront())) {
      yield listener(value);
    }
  }

  *callReversed(value: T) {
    let listener;

    while ((listener = this.popBack())) {
      yield listener(value);
    }
  }

  release() {
    if (this.#released) return;
    this.#released = true;
    const onDispose = this.#onDispose;
    this.#onDispose = undefined;
    onDispose?.();
  }

  dispose() {
    this.#handlers = this.#onRemove = undefined;
    this.release();
  }

  [Symbol.dispose]() {
    return this.dispose();
  }

  popFront(): ((value: T) => Ret) | undefined {
    let handler;

    while ((handler = this.#handlers?.shift())) {
      const { listener, paused } = handler;
      if (paused || !listener) continue;

      this.#removeIfNeeded(handler);
      return wrapListener(listener);
    }

    this.#cleanupHandlersIfNeeded();
  }

  popBack(): ((value: T) => Ret) | undefined {
    let handler;

    while ((handler = this.#handlers?.pop())) {
      const { listener, paused } = handler;
      if (paused || !listener) continue;

      this.#removeIfNeeded(handler);
      return listener;
    }

    this.#cleanupHandlersIfNeeded();
  }
}

export interface GenericEventController<
  T,
  Ret = void,
  Async extends boolean = false,
  Context = void,
> extends Disposable {
  readonly emitter: GenericEventEmitter<T, Ret>;
  readonly getListeners: (this: void) => MaybePromise<ListenerSet<T, Ret>, Async>;
  readonly dispose: (this: void) => void;
  get context(): Context;
}

export type GenericEventEmitterParams<
  T,
  Ret,
  Async extends boolean = false,
  Context = void,
> = OptionalUndefinedProps<GenericEventEmitterParams.Base<T, Ret, Async, Context>>;

export namespace GenericEventEmitterParams {
  export interface Base<T, Ret, Async extends boolean, Context> extends GenericEventLifecycle<
    T,
    Ret,
    Async,
    Context
  > {
    context:
      | ((ctrl: GenericEventController<T, Ret, Async>) => Context)
      | (undefined extends Context ? undefined : never);
    isAsync: Async | (false extends Async ? undefined : never);
  }
}

const controllerFinalizationRegistry = new FinalizationRegistry(
  (state: GenericEventEmitterState<any, any, boolean, any>) => state.dispose(),
);

type GenericEventLifecycle<T, Ret, Async extends boolean, Context> = SubscriptionLifecycle<
  [controller: GenericEventController<T, Ret, Async, Context>],
  [controller: GenericEventController<T, Ret, Async, Context>]
>;

class GenericEventEmitterState<T, Ret, Async extends boolean, Context> {
  handlers: Map<EventListenerKey, Handler<T, Ret>> | undefined = new Map();
  #activeCount = 0;

  readonly #lifecycle;

  controller?: WeakRef<GenericEventController<T, Ret, Async, Context>> | undefined;

  constructor(lifecycle: GenericEventLifecycle<T, Ret, Async, Context>) {
    this.#lifecycle = new SubscriptionLifecycleManager(lifecycle);
  }

  #getLifecycleArgs() {
    const controller = this.controller?.deref();
    if (!controller) return undefined;
    return [controller] as const;
  }

  addHandler(handler: Handler<T, Ret>) {
    if (!this.handlers) return 'disposed';
    if (this.handlers.has(handler.key)) return;

    const { paused } = handler;

    if (!paused && this.#activeCount++ === 0) {
      const args = this.#getLifecycleArgs();
      if (!args) return;
      this.#lifecycle.init(...args).resume(...args);
    }

    this.handlers.set(handler.key, handler);
    return;
  }

  removeHandler(key: EventListenerKey): boolean {
    if (!this.handlers) return false;
    const handler = this.handlers.get(key);
    if (!handler) return false;
    this.handlers.delete(key);

    const { paused } = handler;

    handler.dispose?.();

    if (!paused && --this.#activeCount === 0) {
      this.#lifecycle.pause();
    }

    return true;
  }

  resumeHandler(key: EventListenerKey) {
    const handler = this.handlers?.get(key);
    if (!handler) return;
    const { paused } = handler;
    handler.paused = false;

    if (paused && this.#activeCount++ === 0) {
      const args = this.#getLifecycleArgs();
      if (!args) return;

      this.#lifecycle.init(...args).resume(...args);
    }
  }

  pauseHandler(key: EventListenerKey) {
    const handler = this.handlers?.get(key);
    if (!handler) return;
    const { paused } = handler;
    handler.paused = true;

    if (!paused && --this.#activeCount === 0) {
      this.#lifecycle.pause();
    }
  }

  dispose() {
    controllerFinalizationRegistry.unregister(this);
    const handlers = this.handlers;
    this.handlers = undefined;

    if (!handlers) return;

    for (const handler of handlers.values()) {
      const { dispose } = handler;
      handler.dispose = handler.listener = undefined;

      dispose?.();
    }

    handlers.clear();

    this.#lifecycle.dispose();
  }
}

export interface AddListenerOptions {
  signal?: AbortSignal | undefined;
  once?: boolean | undefined;
  key?: EventListenerKey | undefined;
  onRemove?: (() => void) | undefined;
}

export class GenericEventEmitter<T, Ret = void> {
  #state;

  private constructor(state: WeakRef<GenericEventEmitterState<T, Ret, boolean, any>> | undefined) {
    this.#state = state;
  }

  get isDisposed() {
    return !this.#state?.deref()?.handlers;
  }

  add(listener: (this: void, value: T) => Ret, options?: AddListenerOptions): Subscription {
    const { signal, onRemove, once = false } = options ?? {};

    if (signal?.aborted) return Subscription.noop;

    let _state = this.#state;
    const state = _state?.deref();
    if (!state) return Subscription.noop;

    if (options?.key != null) {
      state.removeHandler(options.key);
    }

    const key = options?.key ?? {};

    const handler: Handler<T, Ret> = { key, listener, once, paused: false };

    const sub = Subscription.fromLifecycle({
      init: () => ({
        resume: first => {
          if (!first) {
            _state?.deref()?.resumeHandler(key);
          }

          return { pause: () => _state?.deref()?.pauseHandler(key) };
        },
      }),
      dispose: () => {
        const s = _state;
        _state = undefined;
        s?.deref()?.removeHandler(key);
      },
      isActive: () => !!_state?.deref()?.handlers?.has(key),
    });

    let removeSignal = undefined;

    if (signal) {
      const onAbort = () => sub.dispose();
      signal.addEventListener('abort', onAbort, { once: true });
      removeSignal = () => signal.removeEventListener('abort', onAbort);
    }

    handler.dispose =
      onRemove && removeSignal ?
        () => {
          try {
            removeSignal();
          } finally {
            onRemove();
          }
        }
      : onRemove || removeSignal;

    state.addHandler(handler);

    return sub;
  }

  has(key: EventListenerKey | undefined | null): boolean {
    return key != null && !!this.#state?.deref()?.handlers?.has(key);
  }

  remove(key: EventListenerKey | undefined | null): boolean {
    if (key == null) return false;
    return this.#state?.deref()?.removeHandler(key) ?? false;
  }

  static readonly #Controller = class Controller<
    T,
    Ret,
    Async extends boolean,
    Context,
  > implements GenericEventController<T, Ret, Async, Context> {
    #state;

    #inUse = false;
    #notifyQueue: Array<() => void> = [];
    readonly #isAsync: Async;

    #context: Context | undefined;
    #getContext: ((ctrl: GenericEventController<T, Ret, Async>) => Context) | undefined;

    constructor(params: GenericEventEmitterParams<T, Ret, Async, Context>) {
      const { context, isAsync, ...lifecycle } = params;
      this.#isAsync = isAsync ?? (false as Async);
      this.#state = new GenericEventEmitterState(lifecycle);
      this.#state.controller = new WeakRef(this);
      this.emitter = new GenericEventEmitter(new WeakRef(this.#state));
      this.#getContext = context;

      controllerFinalizationRegistry.register(this, this.#state, this.#state);
    }

    readonly emitter: GenericEventEmitter<T, Ret>;
    readonly getListeners = (): MaybePromise<ListenerSet<T, Ret>, Async> => {
      let onDispose: (() => void) | undefined;

      const inner = () => {
        this.#inUse = this.#isAsync;

        const handlers = this.#state.handlers && Array.from(this.#state.handlers.values());

        if (!handlers && !onDispose) return ListenerSetImpl.EMPTY;

        return ListenerSetImpl.create(handlers, {
          onRemove: handlers && (({ key }) => void this.#state.removeHandler(key)),
          onDispose,
        });
      };

      if (this.#isAsync) {
        onDispose = () => {
          const next = this.#notifyQueue.shift();

          if (next) {
            next();
          } else {
            this.#inUse = false;
          }
        };

        if (this.#inUse) {
          return new Promise<void>(resolve => void this.#notifyQueue.push(resolve)).then(
            inner,
          ) as MaybePromise<ListenerSet<T, Ret>, Async>;
        }
      }

      return inner();
    };
    readonly dispose = () => this.#state.dispose();
    readonly [Symbol.dispose] = this.dispose;

    get context(): Context {
      const cx = this.#getContext;
      if (cx) {
        this.#getContext = undefined;
        this.#context = cx(this as GenericEventController<T, Ret, Async>);
      }
      return this.#context!;
    }
  };

  static createController<T, Ret = void, Async extends boolean = false, Context = void>(
    this: void,
    params: GenericEventEmitterParams<T, Ret, Async, Context>,
  ): GenericEventController<T, Ret, Async, Context> {
    return new GenericEventEmitter.#Controller(params);
  }

  static create<T, Ret = void, Async extends boolean = false>(
    this: void,
    params: GenericEventEmitterParams<T, Ret, Async>,
  ) {
    return GenericEventEmitter.createController(params).emitter;
  }
}
