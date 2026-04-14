import { isPromiseLike } from '@youngspe/common-async-utils';
import type { CancellableOptions } from '../cancel.ts';
import { GenericEventEmitter, type AddListenerOptions } from '../events.ts';
import { Scope, type ScopeContext } from '../scope.ts';
import { Token } from '../token.ts';
import type { Awaitable, OptionalUndefinedParams, UndefinedIfDefault } from '../types.ts';

type OnNextEventListenerReturn<U, Ret> = UndefinedIfDefault<
  OptionalUndefinedParams<[Awaitable<U>, Ret]>,
  []
>;
type OnNextEventListenerReturnAsync<U, Ret> = PromiseLike<
  UndefinedIfDefault<OptionalUndefinedParams<[Awaitable<U>, Awaitable<Ret>]>>
>;

interface NextEventOptions<UCancel> extends CancellableOptions, Pick<AddListenerOptions, 'passive'> {
  onDispose?: (() => Awaitable<UCancel>) | undefined;
}

export function onNextEvent<T, Ret, U, UCancel = never>(
  emitter: GenericEventEmitter<T, Promise<Ret>>,
  listener: (this: void, cx: ScopeContext<{ value: T }>) => OnNextEventListenerReturnAsync<U, Ret>,
  options?: NextEventOptions<UCancel>,
): Promise<U | UCancel>;
export function onNextEvent<T, Ret, U, UCancel = never>(
  emitter: GenericEventEmitter<T, Ret>,
  listener: (this: void, cx: ScopeContext<{ value: T }>) => OnNextEventListenerReturn<U, Ret>,
  options?: NextEventOptions<UCancel>,
): Promise<U | UCancel>;
export async function onNextEvent<T, Ret, U, UCancel = never>(
  emitter: GenericEventEmitter<T, Ret | Promise<Ret>>,
  listener: (
    this: void,
    cx: ScopeContext<{ value: T }>,
  ) => OnNextEventListenerReturn<U, Ret> | OnNextEventListenerReturnAsync<U, Ret>,
  options?: NextEventOptions<UCancel>,
): Promise<U | UCancel> {
  const scope = Scope.from(options);
  scope.throwIfClosed();

  let onDispose = options?.onDispose;

  using _sub =
    onDispose
    && scope.token.add(() => {
      onDispose = undefined;
    });

  return await scope.resolveOrCancel(
    new Promise((resolve, reject) => {
      emitter.add(
        value => {
          try {
            _sub?.dispose();
            onDispose = undefined;
            const result = listener(scope.withContextValues({ value }).getContext());
            if (isPromiseLike(result))
              return Promise.resolve(
                result.then(args => {
                  resolve(args?.[0] as Awaitable<U>);
                  return args?.[1] as Awaitable<Ret>;
                }),
              ).catch(error => {
                reject(error);
                throw error;
              });

            resolve(result?.[0] as Awaitable<U>);
            return result?.[1] as Ret;
          } catch (error) {
            reject(error);
            throw error;
          }
        },
        {
          once: true,
          scope,
          passive: options?.passive,
          onRemove:
            (_sub || onDispose)
            && (() => {
              _sub?.dispose();
              if (onDispose) {
                try {
                  resolve(onDispose());
                } catch (error) {
                  reject(error);
                }
              }
            }),
        },
      );
    }),
  );
}

export function nextEvent<T, UCancel = never>(
  emitter: GenericEventEmitter<T, undefined>,
  options?: NextEventOptions<UCancel>,
): Promise<T | UCancel> {
  return onNextEvent(emitter, ({ value }) => [value], options);
}
