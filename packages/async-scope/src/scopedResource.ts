class ScopedResourceKey<in _TIn extends _TOut, out _TOut = _TIn> {
  declare private _: unknown;
}

interface ScopedResourceReadKey<out T> extends ScopedResourceKey<never, T> {}
interface ScopedResourceWriteKey<in T> extends ScopedResourceKey<T, unknown> {}

class ScopedResourceCollection {
  #items = new Map<ScopedResourceKey<any>, any>();
}
