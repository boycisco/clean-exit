import React, { useState } from 'react';
import { ConnectionProvider, useConnection } from './context/ConnectionContext.tsx';
import { ConnectionScreen } from './features/connection/ConnectionScreen.tsx';
import { Header } from './components/layout/Header.tsx';
import { Sidebar, AppView } from './components/layout/Sidebar.tsx';
import { OverviewDashboard } from './features/overview/OverviewDashboard.tsx';
import { AgentsList } from './features/agents/AgentsList.tsx';
import { AgentDetails } from './features/agents/AgentDetails.tsx';
import { SettingsView } from './features/settings/SettingsView.tsx';
import { RegisterAgentModal } from './features/agents/RegisterAgentModal.tsx';
import type { Agent } from './types/api.ts';

function MainApp() {
  const { isConnected } = useConnection();
  const [currentView, setCurrentView] = useState<AppView>('overview');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isRegisterAgentModalOpen, setIsRegisterAgentModalOpen] = useState(false);

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
      case 'settings':
        return 'Settings';
      default:
        return 'Clean Exit';
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex">
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => {
          setCurrentView(view);
        }}
        isOpenMobile={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-[var(--sidebar-width)]">
        <Header
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          titleOrBreadcrumb={getHeaderTitle()}
        />

        <main className="flex-1 px-4 sm:px-8 pt-7 pb-10 overflow-y-auto">
          {currentView === 'overview' && (
            <OverviewDashboard
              onSelectAgent={handleSelectAgent}
              onOpenRegisterModal={() => setIsRegisterAgentModalOpen(true)}
              onNavigateToAgents={() => setCurrentView('agents')}
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
            />
          )}

          {currentView === 'settings' && (
            <SettingsView />
          )}
        </main>
      </div>

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