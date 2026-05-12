import { mock, beforeEach, afterEach, type Mock } from 'node:test';

import { useFakeTimers } from '@private/test-utils/install-fake-timers';
import assert from 'assert/strict';

let log: Mock<(...args: any) => void> | undefined;
useFakeTimers();

beforeEach(() => {
  log = mock.method(console, 'log');
  log.mock.mockImplementation(() => {});
});
afterEach(() => {
  mock.restoreAll();
  log = undefined;
});

export const getLogs = (): unknown[][] => {
  if (!log) {
    assert.fail('console.log not mocked');
  }
  return log.mock.calls.map(c => c.arguments as unknown[]);
};
