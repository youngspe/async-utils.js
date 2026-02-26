export class ImmediateError extends TypeError {
  static {
    this.prototype.name = 'ImmediateError';
  }
}

export class ImmediateUnwrapError extends ImmediateError {
  public promise: PromiseLike<unknown> | undefined;

  static {
    this.prototype.name = 'ImmediateUnwrapError';
  }

  constructor(
    promise?: PromiseLike<unknown> | null,
    ...args: ConstructorParameters<typeof ImmediateError>
  ) {
    super(...args);
    this.promise = promise ?? undefined;
  }
}
