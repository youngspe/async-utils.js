import { ResourceKey } from './scopedResource.ts';
import type { Clock } from './timers.ts';

export const clock = ResourceKey.create<Clock>('clock');
