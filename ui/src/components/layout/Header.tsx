import React from 'react';
import { Menu, ChevronRight } from 'lucide-react';
import { useConnection } from '../../context/ConnectionContext.tsx';

interface HeaderProps {
  onOpenMobileNav: () => void;
  breadcrumb: string;
}

export function Header({ onOpenMobileNav, breadcrumb }: HeaderProps) {
  const { isConnected, capabilities } = useConnection();

  const networkName = capabilities?.network
    ? capabilities.network.charAt(0).toUpperCase() + capabilities.network.slice(1)
    : 'Testnet';

  return (
    <header
      style={{ height: 'var(--topbar-height)' }}
      className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] shrink-0"
    >
      {/* Left side: Mobile menu + Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="lg:hidden p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-[var(--radius-sm)] transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>

        {/* The Breadcrumb */}
        <div className="hidden lg:flex items-center gap-2 text-[13px]">
          <span className="text-[var(--text-muted)]">Workspace</span>
          <ChevronRight size={14} className="text-[var(--text-muted)] opacity-50" />
          <span className="font-medium text-[var(--text-primary)]">{breadcrumb}</span>
        </div>
      </div>

      {/* Right side: Environment label and connection indicator */}
      <div className="flex items-center gap-5 text-[12px] shrink-0">
        <div className="text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">Environment: </span>
          <span className="font-medium text-[var(--text-primary)]">{networkName}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">Connection: </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isConnected ? 'bg-[var(--status-success)]' : 'bg-[var(--status-danger)]'
              }`}
              aria-hidden="true"
            />
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </span>
        </div>
      </div>
    </header>
  );
}