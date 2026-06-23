import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { isWorkspaceId, type WorkspaceId } from './workspaces';

interface WorkspaceCtx {
  activeWorkspace: WorkspaceId;
  setWorkspace(id: WorkspaceId): void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeWorkspace, setActive] = useState<WorkspaceId>('close');
  const value = useMemo<WorkspaceCtx>(() => ({
    activeWorkspace,
    // Guard against unknown ids — fail-closed, never set a non-existent workspace.
    setWorkspace: (id) => { if (isWorkspaceId(id)) setActive(id); },
  }), [activeWorkspace]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return v;
}
