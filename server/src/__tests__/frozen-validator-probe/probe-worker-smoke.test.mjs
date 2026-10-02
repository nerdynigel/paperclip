import { test, expect } from 'vitest';
test('bounded worker smoke', () => {
  expect(process.env.TEST).toBe('true');
  expect(process.env.VITEST).toBe('true');
  expect(process.env.NODE_ENV).toBe('production');
  expect(typeof process.send).toBe('function');
});
