import { Token, type Scope, type ScopeContext } from '@youngspe/async-scope';
import { Deque } from '@youngspe/common-async-utils';

import { type Flow, type ToFlow, toFlowAsync } from '#pkg/flow';

import { AbstractFlow, FlowError, type FlowExecutorContext } from './abstract.ts';

interface Resolvers {
  resolve: (this: void, value?: undefined) => void;
  reject: (this: void, reason: unknown) => void;
}

interface Item<T> {
  value: T;
  scope: Scope;
}

export class MergeFlow<T, TReturn, U = ToFlow<T, unknown, undefined>> extends AbstractFlow<
  T,
  TReturn,
  unknown
> {
  #inner;
  #fn;

  constructor(
    inner: Flow<U, TReturn, undefined>,
    fn?: (cx: ScopeContext<{ value: U }>) => ToFlow<T, unknown, undefined>,
    scope?: Scope,
  ) {
    super(scope);
    this.#inner = inner;
    this.#fn = fn;
  }

  protected override async _each({
    scope: outerScope,
    cancel,
    emitScoped,
  }: ScopeContext<FlowExecutorContext<T, unknown>>): Promise<TReturn> {
    const fn = this.#fn;

    const valueQueue = new Deque<Item<T>>();
    const innerFlowResumeResolverQueue = new Deque<Resolvers>();

    let mainFlowResumeResolvers: Resolvers | undefined;
    let endResolvers: Resolvers | undefined;

    using _rejectSub = outerScope.token.add(error => {
      for (const { reject } of innerFlowResumeResolverQueue.drain()) {
        reject(error);
      }

      mainFlowResumeResolvers?.reject(error);
      endResolvers?.reject(error);
    });

    const pollNextItem = async (scope: Scope): Promise<Item<T> | undefined> => {
      while (true) {
        await Promise.resolve();
        scope.throwIfClosed();

        const item = valueQueue.shift();
        if (item) return item;

        const resolvers = innerFlowResumeResolverQueue.shift();

        if (!resolvers) return undefined;

        resolvers.resolve();
      }
    };

    const requestNextItem = async (scope: Scope): Promise<Item<T> | undefined> => {
      while (true) {
        const item = await pollNextItem(scope);

        if (item) return item;

        const resumeMain = mainFlowResumeResolvers?.resolve;
        if (!resumeMain) return;

        mainFlowResumeResolvers = undefined;
        resumeMain();
      }
    };

    const beginEmitLoop = (item: Item<T>) =>
      void outerScope
        .runCancellable(async ({ scope }) => {
          looping = true;
          try {
            while (true) {
              await emitScoped(item, () => undefined);

              const nextItem = await requestNextItem(scope);

              if (!nextItem) return;
              item = nextItem;
            }
          } finally {
            looping = false;
          }
        })
        .catch(cancel);

    const beginInnerFlow = (innerFlow: Flow<T, unknown, undefined>, scope: Scope) =>
      void scope
        .runCancellable(async () => {
          if (looping) {
            await new Promise<undefined>((resolve, reject) => {
              innerFlowResumeResolverQueue.push({ resolve, reject });
            });
          }

          await innerFlow.each(({ value, scope: innerScope }) => {
            const item = { value, scope: innerScope };
            if (looping) {
              valueQueue.push(item);
            } else {
              beginEmitLoop(item);
            }

            return new Promise<undefined>((resolve, reject) => {
              innerFlowResumeResolverQueue.push({ resolve, reject });
            });
          });
        })
        .then(
          () => {
            if (--flowCount === 0) {
              endResolvers?.resolve();
            }
          },
          e => (endResolvers?.reject ?? mainFlowResumeResolvers?.reject ?? cancel)(e),
        );

    let looping: boolean;
    let flowCount = 0;

    const out = await this.#inner.each(
      async ({ value, scope }) => {
        const token = Token.from([outerScope, scope.token.filter(e => !(e instanceof FlowError))]);

        scope = scope.replaceToken(token);
        ++flowCount;

        const innerFlow = await toFlowAsync(
          fn ? fn(scope.getContext({ values: { value } })) : (value as ToFlow<T, unknown, undefined>),
        );

        beginInnerFlow(innerFlow, scope);

        if (looping) {
          await new Promise((resolve, reject) => {
            mainFlowResumeResolvers = { resolve, reject };
          });
        }
      },
      { scope: outerScope },
    );

    if (flowCount > 0) {
      await new Promise<undefined>((resolve, reject) => {
        endResolvers = { resolve, reject };
      });
    }

    return out;
  }
}
