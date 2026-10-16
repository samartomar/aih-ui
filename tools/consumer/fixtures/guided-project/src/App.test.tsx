import { expect, test } from 'vitest';
import App from './App';

test('provides the fixture app', () => {
  expect(App).toBeTypeOf('function');
});
