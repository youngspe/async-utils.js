import { Token } from '../token.ts';
import { Scope } from '../scope.ts';
import { ScopedResources } from '../scopedResource.js';

export class StandardScope extends Scope {
  #resources;
  #token;
  #onError;

  override get token(): Token {
    return this.#token;
  }

  override get resources(): ScopedResources {
    return this.#resources;
  }

  protected override _onError(value: unknown): void {
    return this.#onError ? this.#onError(value) : super._onError(value);
  }

  constructor(params: {
    token?: Token | undefined;
    resources?: ScopedResources | undefined;
    onError?: ((e: unknown) => void) | undefined;
  }) {
    super();
    this.#token = params.token ?? Token.static;
    this.#resources = (params.token?.isCancelled ? undefined : params.resources) ?? ScopedResources.empty;
    this.#onError = params.onError;
  }
}
