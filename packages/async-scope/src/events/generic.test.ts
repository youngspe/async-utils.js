import { suite, test } from 'node:test';
import assert from 'node:assert/strict';

import { GenericEventEmitter, type GenericEventController } from './generic.ts';
import type { Awaitable } from '../types.ts';

suite('GenericEventEmitter', () => {
  suite('simple async event', () => {
    const createSimpleEvent = <T>() => {
      const ctrl: GenericEventController<T, Awaitable<void>, true> = GenericEventEmitter.createController({
        isAsync: true,
      });

      return Object.assign(ctrl, {
        emit: async (value: Awaitable<T>) => {
          using listeners = await ctrl.getListeners();
          const _value = await value;
          await Promise.all(listeners.listeners().map(l => Promise.resolve(l(_value))));
        },
      });
    };

    test('a listener gets called on emit', async () => {
      using ctrl = createSimpleEvent<number>();
      const { emitter } = ctrl;

      const calls: number[] = [];

      emitter.add(x => void calls.push(x));

      await ctrl.emit(1);
      await ctrl.emit(2);
      await ctrl.emit(3);

      assert.deepEqual(calls, [1, 2, 3]);
    });

    test('a listener does not get called after unsubscribing', async () => {
      using ctrl = createSimpleEvent<number>();
      const { emitter } = ctrl;

      const calls: number[] = [];

      const sub = emitter.add(x => void calls.push(x));

      await ctrl.emit(1);
      await ctrl.emit(2);
      sub.dispose();
      await ctrl.emit(3);

      assert.deepEqual(calls, [1, 2]);
    });

    test('a listener does not get called when paused', async () => {
      using ctrl = createSimpleEvent<number>();
      const { emitter } = ctrl;

      const calls: number[] = [];

      const sub = emitter.add(x => void calls.push(x));

      await ctrl.emit(1);
      sub.pause();
      await ctrl.emit(2);
      sub.resume();
      await ctrl.emit(3);

      assert.deepEqual(calls, [1, 3]);
    });
  });
});
