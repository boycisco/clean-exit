import React from 'react';
import {
  LayoutDashboard,
  ShieldCheck,
  Settings,
  Plug,
  X,
} from 'lucide-react';

export type AppView =
  | 'overview'
  | 'agents'
  | 'agent-detail'
  | 'settings'
  | 'connection';

interface SidebarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  currentView,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const mainNavItems = [
    {
      id: 'overview' as AppView,
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      id: 'agents' as AppView,
      label: 'Agents',
      icon: ShieldCheck,
      matchViews: ['agents', 'agent-detail'],
    },
  ];

  const bottomNavItems = [
    {
      id: 'settings' as AppView,
      label: 'Settings',
      icon: Settings,
    },
    {
      id: 'connection' as AppView,
      label: 'API connection',
      icon: Plug,
    },
  ];

  const handleNavClick = (viewId: AppView) => {
    onNavigate(viewId);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px] lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar: exactly 232px width */}
      <aside
        style={{ width: 'var(--sidebar-width)' }}
        className={`fixed top-0 bottom-0 left-0 z-40 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col justify-between px-4 pt-[22px] pb-4 transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col flex-1">
          {/* Brand Row */}
          <div className="flex items-center justify-between mb-9">
            <div
              onClick={() => handleNavClick('overview')}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              {/* Small abstract geometric icon */}
              <div className="w-5 h-5 rounded-[4px] bg-[var(--accent)] flex items-center justify-center shrink-0">
                <div className="w-2.5 h-2.5 bg-[var(--accent-text)] rounded-[1.5px]" />
              </div>
              <span className="text-[16px] font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                clean exit
              </span>
            </div>

            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded"
              aria-label="Close sidebar"
            >
              <X size={16} />
            </button>
          </div>

          {/* Main Navigation (36px below brand) */}
          <nav className="space-y-1">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.matchViews
                ? item.matchViews.includes(currentView)
                : currentView === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  style={{ height: '38px' }}
                  className={`w-full flex items-center gap-[10px] px-[11px] rounded-[6px] text-[13px] font-medium text-left transition-colors ${
                    isActive
                      ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Nav Items: Settings and API Connection */}
        <div className="pt-4 border-t border-[var(--border-subtle)] space-y-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                style={{ height: '38px' }}
                className={`w-full flex items-center gap-[10px] px-[11px] rounded-[6px] text-[13px] font-medium text-left transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}