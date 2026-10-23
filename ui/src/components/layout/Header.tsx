import React from 'react';
import { Menu } from 'lucide-react';
import { useConnection } from '../../context/ConnectionContext.tsx';

interface HeaderProps {
  onOpenMobileNav: () => void;
  titleOrBreadcrumb?: React.ReactNode;
}

export function Header({ onOpenMobileNav, titleOrBreadcrumb }: HeaderProps) {
  const { isConnected, capabilities } = useConnection();

  const networkName = capabilities?.network
    ? capabilities.network.charAt(0).toUpperCase() + capabilities.network.slice(1)
    : 'Testnet';

  return (
    <header
      style={{ height: 'var(--topbar-height)' }}
      className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] shrink-0"
    >
      {/* Left side: Page title or compact breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="lg:hidden p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-[var(--radius-sm)] transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>

        <div className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
          {titleOrBreadcrumb || 'Overview'}
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
