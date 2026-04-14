import { signalCodes } from './constants.ts';

export abstract class Termination extends Error {
  static {
    this.prototype.name = this.name;
  }

  abstract readonly exitCode: number;
  abstract readonly severity: number;
}

export namespace Termination {
  export class Signal<out S extends NodeJS.Signals = NodeJS.Signals> extends Termination {
    static {
      this.prototype.name = this.name;
    }

    constructor(public readonly sig: S) {
      super();
    }

    override get exitCode(): number {
      return (signalCodes[this.sig] ?? 1) + 128;
    }

    readonly severity = 1;
  }

  export class Exit extends Termination {
    static {
      this.prototype.name = this.name;
    }

    constructor(public readonly exitCode: number) {
      super();
    }

    override get severity() {
      return this.exitCode === 0 ? 0 : 2;
    }
  }

  export class Uncaught extends Termination {
    static {
      this.prototype.name = this.name;
    }

    constructor(cause: unknown) {
      if (cause instanceof Termination) return cause;
      super(undefined, { cause });
    }
    exitCode: number = 1;
    readonly severity: number = 3;
  }
}
