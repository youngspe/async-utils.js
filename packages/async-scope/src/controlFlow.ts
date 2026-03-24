import type { IfExactOptionalPropertiesEnabled, OrNever } from './types.ts';

interface _ControlFlowBase<B, C> {
  readonly break?: B;
  readonly continue?: C;
}
type ControlFlowBase<B, C> = IfExactOptionalPropertiesEnabled<_ControlFlowBase<B, C>, {}>;

export namespace ControlFlow {
  export interface BreakObject<out B> extends ControlFlowBase<B, never> {
    readonly break: B;
  }

  export interface ContinueObject<out C> extends ControlFlowBase<never, C> {
    readonly continue: C;
  }

  export type Break<B = void> = BreakObject<B> & OrNever<B>;
  export type Continue<C = void> = ContinueObject<C> & OrNever<C>;

  export type BreakLike<B = void> =
    | (B extends infer _B extends undefined ? 'break' : never)
    | BreakObject<B>;

  export type ContinueLike<C = void> =
    | (C extends infer _C extends undefined ? _C | undefined | 'continue' : never)
    | ContinueObject<C>;

  export type BreakValue<Cf extends ControlFlowLike<any, any>> =
    | (Cf extends Break<infer B> ? B : never)
    | (Cf extends 'break' ? undefined : never);

  export type ContinueValue<Cf extends ControlFlowLike<any, any>> =
    | (Cf extends Continue<infer C> ? C : never)
    | (Cf extends undefined | 'continue' ? undefined : never);
}
export type ControlFlowLike<B = void, C = void> = ControlFlow.BreakLike<B> | ControlFlow.ContinueLike<C>;
export type ControlFlow<B = void, C = void> = ControlFlow.Break<B> | ControlFlow.Continue<C>;
function getBreakValue<Cf extends ControlFlowLike<B, never>, B = ControlFlow.BreakValue<Cf>>(
  this: void,
  ctrl: Cf | ControlFlowLike<B, never>,
): B;
function getBreakValue<
  Cf extends ControlFlowLike<B>,
  B = ControlFlow.BreakValue<Cf>,
  C = ControlFlow.ContinueValue<Cf>,
>(this: void, ctrl: Cf | ControlFlowLike<B, C>): B | (C extends any ? undefined : never);
function getBreakValue<B>(this: void, ctrl: ControlFlowLike<B, unknown>): B | undefined {
  if (!ctrl || typeof ctrl === 'string') return undefined;
  return ctrl.break;
}
function getContinueValue<
  Cf extends ControlFlowLike<B>,
  B = ControlFlow.BreakValue<Cf>,
  C = ControlFlow.ContinueValue<Cf>,
>(this: void, ctrl: Cf | ControlFlowLike<B, C>): C;
function getContinueValue<
  Cf extends ControlFlowLike<B>,
  B = ControlFlow.BreakValue<Cf>,
  C = ControlFlow.ContinueValue<Cf>,
>(this: void, ctrl: Cf | ControlFlowLike<B, C>): C | (B extends any ? undefined : never);
function getContinueValue<C>(this: void, ctrl: ControlFlowLike<unknown, C>): C | undefined {
  if (!ctrl || typeof ctrl === 'string') return undefined;
  return ctrl.continue;
}
function controlFlowFrom<
  Cf extends ControlFlowLike<B, C>,
  B = ControlFlow.BreakValue<Cf>,
  C = ControlFlow.ContinueValue<Cf>,
>(ctrl: Cf | ControlFlowLike<B, C>): ControlFlow<B, C>;
function controlFlowFrom<B, C>(ctrl: ControlFlowLike<B, C>): ControlFlow<B, C>;
function controlFlowFrom<B, C>(ctrl: ControlFlowLike<B, C>): ControlFlow<B, C> {
  if (ctrl === 'break') return { break: undefined as B };
  if (!ctrl || typeof ctrl === 'string') return { continue: undefined as C };
  return ctrl;
}
export const ControlFlow = {
  break: <B>(value: B): ControlFlow.Break<B> => ({ break: value }),
  continue: <C>(value: C): ControlFlow.Continue<C> => ({ continue: value }),
  breakValue: getBreakValue,
  continueValue: getContinueValue,
  from: controlFlowFrom,
};
