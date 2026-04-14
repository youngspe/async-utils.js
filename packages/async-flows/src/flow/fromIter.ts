import {
  asyncIteratorFrom,
  mapAsyncIterator,
  type MaybeAsyncIterableOrIterator,
} from '@youngspe/async-iter-utils';
import {
  Scope,
  Token,
  type CancellableOptions,
  type ScopeContext,
  type TokenController,
} from '@youngspe/async-scope';
import type { Awaitable } from '@youngspe/async-scope-common';

import { ControlFlow } from '../controlFlow.ts';
import { Flow, FlowBreak, FlowComplete, NewItemReceived } from '../flow.ts';
import { cancellableAsyncIterator } from '../iter.ts';

export class FlowFromIter<T, TReturn, TNext> extends Flow<T, TReturn, TNext> {
  #iter: MaybeAsyncIterableOrIterator<T, TReturn, TNext>;
  #scope: Scope;

  constructor(iter: MaybeAsyncIterableOrIterator<T, TReturn, TNext>, scope: Scope) {
    super();
    this.#iter = iter;
    this.#scope = scope;
  }

  override async tryEach<B = never>(
    handler: (cx: ScopeContext<{ value: T }>) => Awaitable<ControlFlow<Awaitable<B>, Awaitable<TNext>>>,
    options?: CancellableOptions,
  ): Promise<ControlFlow<B, TReturn>> {
    const scope = Scope.from([this.#scope, options]);
    if (scope.isClosed) return Promise.reject(scope.token.error);

    const iter = asyncIteratorFrom(this.#iter);
    let ctrl: TokenController | undefined;

    let next: [TNext] | [] = [];

    while (true) {
      let result;
      try {
        result = await iter.next(...next);
      } catch (error) {
        await ctrl?.cancel(error);
        throw error;
      }
      if (result.done) {
        await ctrl?.cancel(new FlowComplete());
        return { continue: result.value };
      }

      await ctrl?.cancel(new NewItemReceived());
      ctrl = Token.createController();

      let handlerResult;

      try {
        handlerResult = await ControlFlow.fromAsync(
          scope.resolveOrCancel(
            handler(Scope.from([scope, ctrl]).withContextValues({ value: result.value }).getContext()),
          ),
        );
      } catch (error) {
        await Promise.all([ctrl.cancel(error), iter.return?.()]);
        throw error;
      }

      if (!('continue' in handlerResult)) {
        await Promise.all([ctrl.cancel(new FlowBreak()), iter.return?.()]);
        return handlerResult;
      }

      next = [handlerResult.continue];
    }
  }

  override iter(options?: CancellableOptions) {
    return mapAsyncIterator(this.values(options), value => ({ value, scope: Scope.static }));
  }

  override values(options?: CancellableOptions) {
    return cancellableAsyncIterator(this.#iter, options);
  }
}
