import * as ControlFlow from './controlFlow/module.ts';

type ControlFlow<B = unknown, C = unknown> = ControlFlow.Break<B> | ControlFlow.Continue<C>;

export { ControlFlow };
