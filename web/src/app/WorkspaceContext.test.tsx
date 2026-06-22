import { render, act } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';

function setup() {
  let ctx!: ReturnType<typeof useWorkspace>;
  function Probe() { ctx = useWorkspace(); return null; }
  render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
  return () => ctx;
}

it('defaults to the close workspace', () => {
  expect(setup()().activeWorkspace).toBe('close');
});

it('setWorkspace switches the active workspace', () => {
  const get = setup();
  act(() => { get().setWorkspace('reconciliation'); });
  expect(get().activeWorkspace).toBe('reconciliation');
});

it('ignores an unknown workspace id (stays put, never crashes)', () => {
  const get = setup();
  act(() => { get().setWorkspace('does-not-exist' as never); });
  expect(get().activeWorkspace).toBe('close');
});

it('throws if useWorkspace is used outside the provider', () => {
  function Bare() { useWorkspace(); return null; }
  expect(() => render(<Bare />)).toThrow();
});
