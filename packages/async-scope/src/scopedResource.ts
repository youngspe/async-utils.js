import { joinPromises } from './join.ts';
import { Scope } from './scope.ts';
import type { Token } from './token.ts';
import type { Awaitable, Falsy } from './types.ts';
import { isAsyncDisposable, isDisposable } from './utils.ts';

export class ResourceError extends Error {
  static {
    this.prototype.name = this.name;
  }
  resource: ResourceReadKey | undefined;
  constructor(resource?: ResourceReadKey) {
    super();
    this.resource = resource;
  }
}

interface Covariant<out T> {
  _covariant: Covariant<T>;
}

interface Contravariant<in T> {
  _contravariant: Contravariant<T>;
}

declare const _covariant: unique symbol;
declare const _contravariant: unique symbol;

export abstract class ResourceKey<in TIn extends TOut, out TOut = TIn> {
  declare private _base: unknown;

  declare [_covariant]: Covariant<TOut>;
  declare [_contravariant]: Contravariant<TIn>;

  static create<T>(
    this: void,
    name?: string | ((...args: never) => T) | (abstract new (...args: never) => T),
  ): ResourceKey<T> {
    if (name === undefined) {
      const { stack } = new Error();
      name = stack?.match(/\n\s*at\s+([^\s]+)/)?.[1];
    } else if (typeof name === 'function') {
      ({ name } = name);
    }

    return new StandardResourceKey(name || 'unknown');
  }

  #optional?: ResourceReadKey<TOut | undefined>;
  get optional(): ResourceReadKey<TOut | undefined> {
    return (this.#optional ??= new OptionalResourceKey(this));
  }

  static optional<K extends ResourceKey.Structured<T>, T = ResourceKey.Resolved<K>>(
    key: K,
  ): ResourceReadKey<T | undefined> {
    if (key instanceof ResourceKey) return key.optional;
    return new OptionalResourceKey(key);
  }

  abstract toString(): string;
}

abstract class CustomResourceKey<out T> extends ResourceKey<never, T> {
  abstract _resolve(res: ScopedResources): [T] | ResourceError;
}

class StandardResourceKey<T> extends ResourceKey<T> {
  readonly name: string | undefined;
  declare private _: unknown;

  constructor(name: string | undefined) {
    super();
    this.name = name;
  }

  override toString(): string {
    return `ResourceKey(${this.name})`;
  }
}

function formatKey(key: ResourceKey.Structured<unknown>, indent: string = ''): string {
  if (!key) return '∅';

  if (key instanceof ResourceKey) return String(key);

  const parts = ['{\n'];

  for (const [k, v] of Object.entries(key)) {
    parts.push(indent, k, ': ', formatKey(v as ResourceKey.Structured<unknown>, indent + '  '), ',\n');
  }

  parts.push('}');

  return parts.join('');
}

class OptionalResourceKey<T> extends CustomResourceKey<T | undefined> {
  #inner: ResourceKey.Structured<T>;

  constructor(inner: ResourceKey.Structured<T>) {
    super();
    this.#inner = inner;
  }

  override _resolve(res: ScopedResources): ResourceError | [T | undefined] {
    return [res.tryGet(this.#inner)];
  }

  override toString(): string {
    return `optional(${formatKey(this.#inner)})`;
  }

  override get optional() {
    return this;
  }
}

export namespace ResourceKey {
  export type Object<T> = { readonly [K in keyof T]: Structured<T[K]> };

  export type Structured<T> =
    | ResourceReadKey<T>
    | Object<T>
    | (Falsy & (undefined extends T ? unknown : never));

  export type Resolved<K extends Structured<unknown>> =
    K extends Falsy ? undefined
    : K extends ResourceReadKey<infer T> ? T
    : K extends { [k: string]: Structured<unknown> } ? { [P in keyof K]: Resolved<K[P]> }
    : unknown;
}

export interface ResourceReadKey<out T = unknown> extends ResourceKey<never, T> {}
export interface ResourceWriteKey<in T> extends ResourceKey<T, unknown> {}

export class ScopedResources {
  #parents: Set<ScopedResources> | undefined;
  #items: Map<ResourceReadKey, any> | undefined;
  private constructor() {}

  #get<T>(key: ResourceKey.Structured<T>): [T] | ResourceError {
    if (!key) return [undefined as T];

    if (key instanceof CustomResourceKey) {
      return key._resolve(this);
    }

    if (key instanceof ResourceKey) {
      if (this.#items?.has(key)) return [this.#items?.get(key) as T];

      if (this.#parents) {
        for (const parent of this.#parents) {
          const out = parent.#get(key);
          if (out) return out;
        }
      }

      return new ResourceError(key);
    }

    const out: Partial<T> = {};

    for (const [prop, value] of Object.entries(key)) {
      const resolved = this.#get(value as ResourceKey.Structured<any>);
      if (resolved instanceof Error) return resolved;

      (out as { [k: string]: unknown })[prop] = resolved[0];
    }

    return [out] as [T];
  }

  get<K extends ResourceKey.Structured<T>, T = ResourceKey.Resolved<K>>(key: K): T {
    const out = this.#get(key);
    if (out instanceof Error) throw out;
    return out[0];
  }

  tryGet<K extends ResourceKey.Structured<T>, T = ResourceKey.Resolved<K>>(key: K): T | undefined {
    const out = this.#get(key);
    if (out instanceof Error) return undefined;
    return out[0];
  }

  #isEmpty: true | undefined;

  get isEmpty() {
    if (this.#isEmpty) return true;
    if (this.#items?.size) return false;

    if (this.#parents) {
      for (const parent of this.#parents) {
        if (!parent.isEmpty) return false;
        this.#parents.delete(parent);
      }
    }

    return (this.#isEmpty = true);
  }

  #flatten(dest: Set<ScopedResources>, visited: Set<ScopedResources>) {
    if (visited.has(this)) return;
    visited.add(this);

    if (this.#items?.size) {
      dest.add(this);

      const newParents = new Set<ScopedResources>();
      const newVisited = new Set([this]);

      const parents = this.#parents;
      if (!parents) return;

      this.#parents = newParents;

      for (const parent of parents) {
        parent.#flatten(newParents, newVisited);
      }

      return;
    }

    if (!this.#parents) return;

    for (const parent of this.#parents) {
      parent.#flatten(dest, visited);
    }
  }

  static readonly empty = Object.freeze(new this()) as ScopedResources;

  static builder(this: void, token?: Token): ScopedResources.Builder {
    return new ScopedResources.#Builder(token);
  }

  #disposing: Promise<void> | undefined;

  #dispose() {
    return (this.#disposing ??= (async () => {
      const items = this.#items;
      if (!items) return;
      this.#items = undefined;
      this.#parents?.clear();
      await joinPromises(items.values(), item => {
        if (isDisposable(item)) {
          item[Symbol.dispose]();
          return;
        }

        if (isAsyncDisposable(item)) return item[Symbol.asyncDispose]();
      });
      items.clear();
    })());
  }

  static readonly #Builder = class Builder implements ScopedResources.Builder {
    #inherit: ScopedResources[] | undefined = [];
    #put: Map<ResourceReadKey, any> | undefined = new Map();
    #token: Token | undefined;

    constructor(token?: Token) {
      if (token?.isCancelled) {
        this.#inherit = this.#put = undefined;
        return;
      }

      this.#token = token?.isDefused ? undefined : token;
    }

    inherit(parent: ScopedResources | Scope | Falsy): this {
      if (!parent) return this;
      this.#inherit?.push(parent instanceof Scope ? parent.resources : parent);
      return this;
    }

    put<T>(key: ResourceWriteKey<T>, value: T): this {
      this.#put?.set(key, value);
      return this;
    }

    finish(): ScopedResources {
      // Reverse the `inherit` list so that more recently-added entries take precedence.
      const inherit = this.#inherit?.reverse();
      const put = this.#put;
      const token = this.#token;
      this.#inherit = this.#put = this.#token = undefined;

      let parents = undefined;

      if (inherit?.length) {
        const visited = new Set<ScopedResources>();
        const dest = new Set<ScopedResources>();

        inherit.forEach(r => r.#flatten(dest, visited));
        parents = dest.size ? dest : undefined;
      }

      if (!put?.size && (parents?.size ?? 0 <= 1)) {
        const parent = parents?.values().next().value;
        if (!parent) return ScopedResources.empty;
        if (!token) return parent;
      }

      const resources = new ScopedResources();
      resources.#items = put?.size ? put : undefined;
      resources.#parents = parents;
      token?.add(() => resources.#dispose());

      return resources;
    }
  };

  static combine(this: void, collections: Iterable<ScopedResources | Falsy>): ScopedResources {
    const set = new Set<ScopedResources>();
    const visited = new Set<ScopedResources>();

    for (const item of collections) {
      if (!item) continue;
      item.#flatten(set, visited);
    }

    if (set.size > 1) {
      const resources = new ScopedResources();
      resources.#parents = set;
    }

    return set.values().next().value ?? ScopedResources.empty;
  }
}

export namespace ScopedResources {
  export interface Builder {
    inherit(parent: ScopedResources | Scope): this;
    put<T>(key: ResourceWriteKey<T>, value: Awaitable<T>): this;
    finish(): ScopedResources;
  }
}
