import { Token } from '../token.ts';
import { Scope } from '../scope.ts';
import { ScopedResources } from '../scopedResource.js';
import { ContextData } from './context.ts';

export class StandardScope<V extends object> extends Scope<V> {
  #resources;
  #token;
  #onError;
  #contextData: ContextData<V> | undefined;

  override get token(): Token {
    return this.#token;
  }

  override get resources(): ScopedResources {
    return this.#resources;
  }

  override get contextData() {
    return this.#contextData ?? super.contextData;
  }

  protected override _onError(value: unknown): void {
    return this.#onError ? this.#onError(value) : super._onError(value);
  }

  constructor(params: {
    token?: Token | undefined;
    resources?: ScopedResources | undefined;
    contextData?: ContextData<V> | undefined;
    onError?: ((e: unknown) => void) | undefined;
  }) {
    super();
    this.#token = params.token ?? Token.static;
    this.#resources = (params.token?.isCancelled ? undefined : params.resources) ?? ScopedResources.empty;
    this.#contextData = params.token?.isCancelled ? undefined : params.contextData;
    this.#onError = params.onError;
  }
}
