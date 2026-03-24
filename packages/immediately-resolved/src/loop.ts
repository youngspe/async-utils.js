import { Immediate, type ImmediateInput } from './immediate.ts';
import { type ImmediateState } from './state.ts';

interface LoopBreakResultObject<
  B,
  S extends ImmediateState.Initial = ImmediateState,
  _B extends ImmediateInput<B, S> = ImmediateInput<B, S>,
> {
  break: ImmediateInput<B, S>;
  continue?: never;
}

type LoopBreakResult<B = void, S extends ImmediateState.Initial = ImmediateState> =
  | (undefined extends B ? 'break' : never)
  | LoopBreakResultObject<B, S>;

interface LoopContinueResultObject<C, S extends ImmediateState.Initial = ImmediateState> {
  continue: ImmediateInput<C, S>;
  break?: never;
}

type LoopContinueResult<C = void, K extends ImmediateState.Initial = ImmediateState> =
  | (undefined extends C ? 'continue' : never)
  | LoopContinueResultObject<C, K>;

export type LoopResult<B = void, C = void, K extends ImmediateState = ImmediateState> =
  | LoopBreakResult<B, K>
  | LoopContinueResult<C, K>;

export type LoopOutput<
  B = void,
  C = void,
  S extends ImmediateState.Initial = ImmediateState,
  S2 extends ImmediateState.Initial = S,
> = ImmediateInput<LoopResult<B, C, S2>, S>;

type StateOfLoopOutut<O> =
  | (O extends LoopBreakResultObject<any> ? ImmediateState.For<O['break']> : never)
  | (O extends LoopContinueResultObject<any> ? ImmediateState.For<O['continue']> : never)
  | ImmediateState.For<O>;

export function loop<
  Out extends LoopOutput<B, C, S>,
  B = void,
  C = void,
  S extends ImmediateState.Initial = StateOfLoopOutut<Out>,
>(body: (state: C) => Out, ...[_state]: undefined extends C ? [state?: C] : [state: C]): Immediate<B, S> {
  const inner = (result: LoopResult<B, C, S>): Immediate<B, S> => {
    while (true) {
      if (result === 'break') return Immediate.resolve(undefined as B);

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
