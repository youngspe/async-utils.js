import type { Awaitable } from '@youngspe/async-scope-common';
import * as ControlFlow from './controlFlow/module.ts';

type ControlFlow<B = unknown, C = unknown> = ControlFlow.Break<B> | ControlFlow.Continue<C>;

export type AsyncControlFlow<B = unknown, C = unknown> = Awaitable<ControlFlow<Awaitable<B>, Awaitable<C>>>;

export { ControlFlow };
