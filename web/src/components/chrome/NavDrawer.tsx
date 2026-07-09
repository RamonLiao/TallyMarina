import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { WorkspaceNavList } from './WorkspaceNavList';

const FOCUSABLE = 'button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])';

export function NavDrawer() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Focus in on open; body scroll lock; focus back to the toggle on close.
  // Both live in one effect so the restore path cannot drift from the setup.
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      toggleRef.current?.focus();
    };
  }, [open]);

  // Above the mobile breakpoint the drawer's `position: fixed` rule stops
  // applying, so it reflows into the header (measured: header 72px -> 570px)
  // while body scroll stays locked and the ☰ that would close it is
  // display:none. State has to follow the media query, not fight it. Closing
  // here reuses the effect cleanup above, which restores body.overflow.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => { if (!mq.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open]);

  // Escape closes. Tab cycles within the drawer (aria-modal does not do this).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const node = drawerRef.current;
      if (!node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-label="Open workspaces menu"
        aria-expanded={open}
        aria-controls="nav-drawer"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
             strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {open && (
        <>
          <div className="nav-scrim" data-testid="nav-scrim" onClick={close} />
          <div
            id="nav-drawer"
            ref={drawerRef}
            className="nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Workspaces"
          >
            <div className="wallet-slot nav-drawer-wallet"><ConnectButton /></div>
            <hr className="nav-drawer-sep" />
            <WorkspaceNavList onNavigate={close} />
          </div>
        </>
      )}
    </>
  );
}
