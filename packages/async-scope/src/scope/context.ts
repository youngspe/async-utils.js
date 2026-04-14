import type { Defined, SetProps, UpdateObject } from '../types.ts';
import type { ScopeContext, ScopeContextBase } from './base.ts';

type Descriptors<V extends object> = {
  [K in keyof V]: { value: Defined<V[K]> } | { get(this: ScopeContext<V>): V[K] };
};

const contextProps: { [_ in keyof ScopeContext]: undefined } = {
  resources: undefined,
  scope: undefined,
  signal: undefined,
  token: undefined,
};

export class ContextData<V extends object = object> {
  #descriptors;

  private constructor(descriptors: Descriptors<V> | undefined) {
    this.#descriptors = descriptors;
  }

  updateContext(target: ScopeContextBase<V>): ScopeContext<V> {
    if (this.#descriptors) {
      const descriptors = this.#descriptors as Descriptors<{ [k: string | symbol]: unknown }>;

      for (const key of [...Object.keys(descriptors), ...Object.getOwnPropertySymbols(descriptors)]) {
        const descriptor = descriptors[key];
        if (!descriptor || key in contextProps) continue;
        Object.defineProperty(target, key, descriptor);
      }
    }

    return target as ScopeContext<V>;
  }

  builder(): ContextDataBuilder<V> {
    return new ContextData.#Builder<V>(Object.assign({}, this.#descriptors));
  }

  static builder(this: void): ContextDataBuilder {
    return new ContextData.#Builder(undefined);
  }

  static empty = Object.freeze(new ContextData(undefined)) as ContextData;

  static #Builder = class Builder<V extends object> implements ContextDataBuilder<V> {
    #builderDescriptors;

    constructor(descriptors: Descriptors<V> | undefined) {
      this.#builderDescriptors = descriptors;
    }

    values<V2 extends object>(props: V2): ContextDataBuilder<UpdateObject<V, V2>>;
    values<V2 extends object>(props: { [k: string | symbol]: unknown }) {
      const descriptors = (this.#builderDescriptors ??= {} as Descriptors<V>) as Descriptors<{
        [k: string | symbol]: unknown;
      }>;

      for (const key of [...Object.keys(props), ...Object.getOwnPropertySymbols(props)]) {
        const value = props[key];
        if (value === undefined) continue;
        descriptors[key] = { value };
      }

      return this as ContextDataBuilder<V | V2> as ContextDataBuilder<UpdateObject<V, V2>>;
    }

    getters<V2 extends object>(getters: {
      [K in keyof V2]: (cx: ScopeContext<SetProps<V, V2>>) => V2[K];
    }): ContextDataBuilder<SetProps<V, V2>>;
    getters<V2 extends object>(getters: { [k: string | symbol]: (cx: ScopeContext) => unknown }) {
      const descriptors = (this.#builderDescriptors ??= {} as Descriptors<V>) as Descriptors<{
        [k: string | symbol]: unknown;
      }>;

      for (const key of [...Object.keys(getters), ...Object.getOwnPropertySymbols(getters)]) {
        const value = getters[key];
        if (value === undefined) continue;
        descriptors[key] = {
          get(this) {
            return value(this);
          },
        };
      }

      return this as ContextDataBuilder<V | V2> as ContextDataBuilder<SetProps<V, V2>>;
    }

    merge<V2 extends object>(contextData: ContextData<V2>): ContextDataBuilder<SetProps<V, V2>> {
      Object.assign((this.#builderDescriptors ??= {} as Descriptors<V>), contextData.#descriptors);
      return this as ContextDataBuilder<V | V2> as ContextDataBuilder<SetProps<V, V2>>;
    }

    finish(): ContextData<V> {
      if (!this.#builderDescriptors) return ContextData.empty as ContextData<V>;
      return new ContextData(this.#builderDescriptors);
    }
  };
}

export interface ContextDataBuilder<V extends object = object> {
  values<V2 extends object>(props: V2): ContextDataBuilder<UpdateObject<V, V2>>;

  getters<V2 extends object>(getters: {
    [K in keyof V2]: (cx: ScopeContext<SetProps<V, V2>>) => V2[K];
  }): ContextDataBuilder<SetProps<V, V2>>;

  merge<V2 extends object>(contextData: ContextData<V2>): ContextDataBuilder<SetProps<V, V2>>;

  finish(): ContextData<V>;
}
