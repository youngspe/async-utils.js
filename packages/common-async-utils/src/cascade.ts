import type { Awaitable, Falsy } from './types.ts';
import { isPromiseLike } from './utils.ts';

type CascadeFunction<T, U> = ((value: T) => Awaitable<U>) | ([T] extends [U] ? Falsy : never);
type CascadeOutput<T> = T | PromiseLike<T>;

interface CascadeOptions<T2> {
  catch?: ((this: void, error: unknown) => Awaitable<T2>) | undefined;
}

export function cascadeSync<A, T2 = never>(
  value: Awaitable<A>,
  funcs: [],
  options?: CascadeOptions<T2>,
): CascadeOutput<A | T2>;
export function cascadeSync<A, B, T2 = never>(
  value: Awaitable<A>,
  funcs: [CascadeFunction<A, B>],
  options?: CascadeOptions<T2>,
): CascadeOutput<B | T2>;
export function cascadeSync<A, B, C, T2 = never>(
  value: Awaitable<A>,
  funcs: [CascadeFunction<A, B>, CascadeFunction<B, C>],
  options?: CascadeOptions<T2>,
): CascadeOutput<C | T2>;
export function cascadeSync<A, B, C, D, T2 = never>(
  value: Awaitable<A>,
  funcs: [CascadeFunction<A, B>, CascadeFunction<B, C>, CascadeFunction<C, D>],
  options?: CascadeOptions<T2>,
): CascadeOutput<D | T2>;
export function cascadeSync<A, B, C, D, E, T2 = never>(
  value: Awaitable<A>,
  funcs: [CascadeFunction<A, B>, CascadeFunction<B, C>, CascadeFunction<C, D>, CascadeFunction<D, E>],
  options?: CascadeOptions<T2>,
): CascadeOutput<E | T2>;
export function cascadeSync<A, B, C, D, E, F, T2 = never>(
  value: Awaitable<A>,
  funcs: [
    CascadeFunction<A, B>,
    CascadeFunction<B, C>,
    CascadeFunction<C, D>,
    CascadeFunction<D, E>,
    CascadeFunction<E, F>,
  ],
  options?: CascadeOptions<T2>,
): CascadeOutput<F | T2>;
export function cascadeSync<A, B, C, D, E, F, G, T2 = never>(
  value: Awaitable<A>,
  funcs: [
    CascadeFunction<A, B>,
    CascadeFunction<B, C>,
    CascadeFunction<C, D>,
    CascadeFunction<D, E>,
    CascadeFunction<E, F>,
    CascadeFunction<F, G>,
  ],
  options?: CascadeOptions<T2>,
): CascadeOutput<G | T2>;
export function cascadeSync<A, B, C, D, E, F, G, H, T2 = never>(
  value: Awaitable<A>,
  funcs: [
    CascadeFunction<A, B>,
    CascadeFunction<B, C>,
    CascadeFunction<C, D>,
    CascadeFunction<D, E>,
    CascadeFunction<E, F>,
    CascadeFunction<F, G>,
    CascadeFunction<G, H>,
  ],
  options?: CascadeOptions<T2>,
): CascadeOutput<H | T2>;
export function cascadeSync<A, B, C, D, E, F, G, H, I, T2 = never>(
  value: Awaitable<A>,
  funcs: [
    CascadeFunction<A, B>,
    CascadeFunction<B, C>,
    CascadeFunction<C, D>,
    CascadeFunction<D, E>,
    CascadeFunction<E, F>,
    CascadeFunction<F, G>,
    CascadeFunction<G, H>,
    CascadeFunction<H, I>,
  ],
  options?: CascadeOptions<T2>,
): CascadeOutput<I | T2>;
export function cascadeSync<T, T2 = never>(
  value: Awaitable<T>,
  funcs: Iterable<CascadeFunction<T, T>>,
  options?: CascadeOptions<T2>,
): CascadeOutput<T | T2>;
export function cascadeSync<T, T2 = never>(
  value: Awaitable<T>,
  funcs: Iterable<CascadeFunction<T, T>>,
  options?: CascadeOptions<T2>,
): CascadeOutput<T | T2> {
  const funcIter = funcs[Symbol.iterator]();

  const inner = (value: Awaitable<T>): T | PromiseLike<T> => {
    let result;
    while (((result = funcIter.next()), !result.done)) {
      const f = result.value;
      if (!f) continue;

      if (isPromiseLike(value)) return value.then(x => inner(f(x)));

      value = f(value);
    }

    return value;
  };

  if (isPromiseLike(value)) return value.then<T, T2>(inner, options?.catch);

  try {
    return inner(value);
  } catch (error) {
    if (options?.catch) return options.catch(error);

    throw error;
  }
}
