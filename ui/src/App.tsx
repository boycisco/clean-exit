import React, { useState } from 'react';
import { ConnectionProvider, useConnection } from './context/ConnectionContext.tsx';
import { ConnectionScreen } from './features/connection/ConnectionScreen.tsx';
import { Header } from './components/layout/Header.tsx';
import { Sidebar, AppView } from './components/layout/Sidebar.tsx';
import { OverviewDashboard } from './features/overview/OverviewDashboard.tsx';
import { AgentsList } from './features/agents/AgentsList.tsx';
import { AgentDetails } from './features/agents/AgentDetails.tsx';
import { ActivityView } from './features/activity/ActivityView.tsx';
import { SettingsView } from './features/settings/SettingsView.tsx';
import { RegisterAgentModal } from './features/agents/RegisterAgentModal.tsx';
import type { Agent } from './types/api.ts';

function MainApp() {
  const { isConnected } = useConnection();
  const [currentView, setCurrentView] = useState<AppView>('overview');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isRegisterAgentModalOpen, setIsRegisterAgentModalOpen] = useState(false);

  // If unauthenticated or token not provided, render ConnectionScreen
  if (!isConnected) {
    return (
      <ConnectionScreen
        onConnected={() => {
          setCurrentView('overview');
        }}
      />
    );
  }

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setCurrentView('agent-detail');
  };

  const handleAgentCreated = (newAgent: Agent) => {
    setSelectedAgentId(newAgent.id);
    setCurrentView('agent-detail');
  };

  const getHeaderTitle = () => {
    switch (currentView) {
      case 'overview':
        return 'Overview';
      case 'agents':
        return 'Agents';
      case 'agent-detail':
        return 'Agent workspace';
      case 'activity':
        return 'Activity';
      case 'settings':
      case 'connection':
        return 'Settings';
      default:
        return 'Clean Exit';
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex">
      {/* 1. Sidebar (Fixed 232px width on desktop) */}
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => {
          setCurrentView(view);
        }}
        isOpenMobile={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      {/* 2. Main Workspace (Fluid area) */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[var(--sidebar-width)]">
        {/* Top bar (Fixed 60px height) */}
        <Header
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          titleOrBreadcrumb={getHeaderTitle()}
        />

        {/* Main Content (Horizontal padding 32px desktop, top 28px, bottom 40px) */}
        <main className="flex-1 px-4 sm:px-8 pt-7 pb-10 overflow-y-auto">
          {currentView === 'overview' && (
            <OverviewDashboard
              onSelectAgent={handleSelectAgent}
              onOpenRegisterModal={() => setIsRegisterAgentModalOpen(true)}
              onNavigateToAgents={() => setCurrentView('agents')}
              onNavigateToActivity={() => setCurrentView('activity')}
            />
          )}

          {currentView === 'agents' && (
            <AgentsList
              onSelectAgent={handleSelectAgent}
              onOpenRegisterModal={() => setIsRegisterAgentModalOpen(true)}
            />
          )}

          {currentView === 'agent-detail' && selectedAgentId && (
            <AgentDetails
              agentId={selectedAgentId}
              onBack={() => setCurrentView('agents')}
              onNavigateToActivity={() => setCurrentView('activity')}
            />
          )}

          {currentView === 'activity' && (
            <ActivityView onSelectAgent={handleSelectAgent} />
          )}

          {(currentView === 'settings' || currentView === 'connection') && (
            <SettingsView />
          )}
        </main>
      </div>

      {/* Register Agent Dialog */}
      <RegisterAgentModal
        isOpen={isRegisterAgentModalOpen}
        onClose={() => setIsRegisterAgentModalOpen(false)}
        onAgentCreated={handleAgentCreated}
      />
    </div>
  );
}

export default function App() {
  return (
    <ConnectionProvider>
      <MainApp />
    </ConnectionProvider>
  );
}
