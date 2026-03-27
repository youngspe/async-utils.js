import type { Token } from '../token.ts';
import { Scope } from '../scope.ts';

export class StandardScope extends Scope {
  #token;

  override get token(): Token {
    return this.#token;
  }

  constructor(token: Token) {
    super();
    this.#token = token;
  }
}
