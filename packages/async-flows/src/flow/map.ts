import { Scope, type CancellableOptions, type ScopeContext, type ToScope } from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';
import { isPromiseLike } from '@youngspe/common-async-utils';

import type { AsyncControlFlow, ControlFlow } from '#pkg/controlFlow';

import { Flow } from './flow.ts';

export const DISCARD_INPUT = (_?: unknown) => undefined;

/**
 * Compose two optional scoped map functions.
 * If `oldFn === undefined`, assume `T extends U`.
 * If `newFn === undefined`, assume `U extends V`.
 */
const uncheckedCompose = <T, U, V>(
  oldFn?: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
  newFn?: (value: ScopeContext<{ value: U }>) => Awaitable<V>,
): ((value: ScopeContext<{ value: T }>) => Awaitable<V>) | undefined =>
  newFn === DISCARD_INPUT ? (DISCARD_INPUT as () => undefined & V)
  : newFn && oldFn ?
    async cx => {
      let value = oldFn(cx);
      if (isPromiseLike(value)) {
        value = await value;
      }
      return newFn(cx.scope.getContext({ values: { value } }));
    }
  : ((newFn || oldFn) as ((cx: ScopeContext<{ value: T }>) => Awaitable<V>) | undefined);

export class ScopedMapFlow<T, U, TReturn, UReturn, TNext, UNext = TNext> extends Flow<U, UReturn, UNext> {
  readonly #inner;
  readonly #fn;
  readonly #inputFn;
  readonly #returnFn;

  constructor(
    inner: Flow<T, TReturn, TNext>,
    fn?: (value: ScopeContext<{ value: T }>) => Awaitable<U>,
    inputFn?: (cx: ScopeContext<{ value: UNext }>) => Awaitable<TNext>,
    returnFn?: (value: ScopeContext<{ value: TReturn }>) => Awaitable<UReturn>,
  ) {
    super();
    this.#inner = inner;
    this.#fn = fn;
    this.#inputFn = inputFn;
    this.#returnFn = returnFn;
  }

  override async tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: U }>) => AsyncControlFlow<B, UNext>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, UReturn>> {
    const fn = this.#fn;
    const inputFn = this.#inputFn;
    const returnFn = this.#returnFn;

    const scope = Scope.from(options);
    scope.throwIfClosed();

    const innerRet = this.#inner.tryEach(
      async cx => {
        let value: U;
        if (fn) {
          const _value = fn(cx);
          value = isPromiseLike(_value) ? await _value : _value;
        } else {
          value = cx.value as T & U;
        }

        const input = await handler(cx.scope.getContext({ values: { value } }));

        if (!inputFn || !('continue' in input)) return input as AsyncControlFlow<B, UNext & TNext>;

        return { continue: inputFn(cx.scope.getContext({ values: { value: await input.continue } })) };
      },
      { scope },
    );

    if (!returnFn) return innerRet as Promise<ControlFlow<B, TReturn & UReturn>>;

    const cf = await innerRet;

    if (!('continue' in cf)) return cf;

    return { continue: await returnFn(scope.getContext({ values: { value: await cf.continue } })) };
  }

  override async each(
    handler: (cx: ScopeContext<{ value: U }>) => Awaitable<UNext>,
    options?: CancellableOptions,
  ): Promise<UReturn> {
    const fn = this.#fn;
    const inputFn = this.#inputFn;
    const returnFn = this.#returnFn;

    const scope = Scope.from(options);
    scope.throwIfClosed();

    const innerRet = this.#inner.each(
      async cx => {
        let value: U;
        if (fn) {
          const _value = fn(cx);
          value = isPromiseLike(_value) ? await _value : _value;
        } else {
          value = cx.value as T & U;
        }

        if (isPromiseLike(value)) {
          value = await value;
        }
        const input = handler(cx.scope.getContext({ values: { value } }));

        return inputFn ?
            inputFn(cx.scope.getContext({ values: { value: await input } }))
          : (input as TNext & UNext);
      },
      { scope },
    );

    if (!returnFn) return innerRet as Promise<TReturn & UReturn>;

    return returnFn(scope.getContext({ values: { value: await innerRet } }));
  }

  override inScope(scope: ToScope): Flow<U, UReturn, UNext> {
    return new ScopedMapFlow(this.#inner.inScope(scope), this.#fn, this.#inputFn);
  }
  override buffer(
    this: ScopedMapFlow<T, U, TReturn, UReturn, TNext, undefined>,
    size: number,
    scope?: Scope,
  ): Flow<U, UReturn, unknown> {
    if (!this.#inputFn || this.#inputFn === DISCARD_INPUT) {
      return new ScopedMapFlow(
        (this.#inner as Flow<T, TReturn, undefined>).buffer(size, scope),
        this.#fn,
        DISCARD_INPUT,
        this.#returnFn,
      );
    }

    return super.buffer(size, scope);
  }

  override mapScoped<V, VReturn, VNext>(
    fn?: (value: ScopeContext<{ value: U }>) => Awaitable<V>,
    inputFn?: (value: ScopeContext<{ value: VNext }>) => Awaitable<UNext>,
    returnFn?: (value: ScopeContext<{ value: UReturn }>) => Awaitable<VReturn>,
  ): Flow<V, VReturn, VNext> {
    return new ScopedMapFlow(
      this.#inner,
      uncheckedCompose(this.#fn, fn),
      uncheckedCompose(inputFn, this.#inputFn),
      uncheckedCompose(this.#returnFn, returnFn),
    );
  }
}
