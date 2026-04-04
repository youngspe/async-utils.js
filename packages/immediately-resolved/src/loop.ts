import { Immediate, type AwaitedValueOf, type ImmediateInput } from './immediate.ts';
import { type ImmediateState } from './state.ts';

export type LoopResult<B = void, C = void, K extends ImmediateState = ImmediateState> =
  | LoopResult.Break<B, K>
  | LoopResult.Continue<C, K>;

export namespace LoopResult {
  export interface BreakObject<
    B,
    S extends ImmediateState.Initial = ImmediateState,
    _B extends ImmediateInput<B, S> = ImmediateInput<B, S>,
  > {
    break: ImmediateInput<B, S>;
    continue?: never;
  }

  export type Break<B = void, S extends ImmediateState.Initial = ImmediateState> =
    | (undefined extends B ? 'break' : never)
    | BreakObject<B, S>;

  export interface ContinueObject<C, S extends ImmediateState.Initial = ImmediateState> {
    continue: ImmediateInput<C, S>;
    break?: never;
  }

  export type Continue<C = void, K extends ImmediateState.Initial = ImmediateState> =
    | (undefined extends C ? 'continue' : never)
    | ContinueObject<C, K>;

  export type BreakValue<R extends LoopResult<any, any>> =
    | (R extends { break: any } ? R['break'] : never)
    | (R extends 'break' ? undefined : never);
  export type ContinueValue<R extends LoopResult<any, any>> =
    | (R extends { continue: any } ? R['continue'] : never)
    | (R extends 'continue' ? undefined : never);
}

export type LoopOutput<
  B = void,
  C = void,
  S extends ImmediateState.Initial = ImmediateState,
  S2 extends ImmediateState.Initial = S,
> = ImmediateInput<LoopResult<B, C, S2>, S>;

type StateOfLoopOutput<O> =
  | (O extends LoopResult.BreakObject<any> ? ImmediateState.For<O['break']> : never)
  | (O extends LoopResult.ContinueObject<any> ? ImmediateState.For<O['continue']> : never)
  | ImmediateState.For<O>;

export function loop<
  const Out extends LoopOutput<B, C, S>,
  B = LoopResult.BreakValue<AwaitedValueOf<Out>>,
  C = void | LoopResult.ContinueValue<AwaitedValueOf<Out>>,
  S extends ImmediateState.Initial = StateOfLoopOutput<Out>,
>(body: (state: C) => Out, ...[_state]: undefined extends C ? [state?: C] : [state: C]): Immediate<B, S> {
  const inner = (result: LoopResult<B, C, S>): Immediate<B, S> => {
    while (true) {
      if (result === 'break') return Immediate.resolve(undefined as ImmediateInput<B, S>);

      let out: Immediate<LoopResult<B, C, S>, S>;

      if (result === 'continue') {
        out = Immediate.resolve<LoopResult<B, C, S>, S>(body(undefined as C));
      } else if ('break' in result) {
        return Immediate.resolve(result.break);
      } else {
        const state = Immediate.resolve<C, S>(result.continue);

        if (!state.isResolved()) {
          return state.then(value => inner({ continue: value }));
        }

        out = Immediate.resolve(body(state.value));
      }

      if (out.isRejected()) return out;

      if (!out.isResolved()) {
        return out.then(inner);
      }

      result = out.value;
    }
  };

  return inner({ continue: _state as C });
}
