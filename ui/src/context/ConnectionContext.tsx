import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  getStoredApiToken,
  getStoredApiBaseUrl,
  setApiSession,
  clearApiSession,
  subscribeAuthChange,
} from '../lib/auth-storage.ts';
import { apiClient, ApiError } from '../lib/api-client.ts';
import type { CapabilitiesResponse } from '../types/api.ts';

interface ConnectionContextValue {
  baseUrl: string;
  token: string | null;
  isConnected: boolean;
  capabilities: CapabilitiesResponse | null;
  isLoadingCapabilities: boolean;
  capabilitiesError: string | null;
  connect: (token: string, baseUrl?: string) => Promise<CapabilitiesResponse>;
  disconnect: () => void;
  refreshCapabilities: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredApiToken());
  const [baseUrl, setBaseUrl] = useState<string>(getStoredApiBaseUrl());
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState<boolean>(false);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);

  const fetchCapabilities = useCallback(
    async (targetUrl?: string, targetToken?: string) => {
      const activeUrl = targetUrl || baseUrl;
      const activeToken = targetToken ?? token;

      setIsLoadingCapabilities(true);
      setCapabilitiesError(null);

      try {
        const caps = await apiClient.getCapabilities(activeUrl, activeToken || undefined);
        setCapabilities(caps);
        return caps;
      } catch (err: unknown) {
        let msg = 'Failed to fetch backend capabilities.';
        if (err instanceof ApiError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setCapabilitiesError(msg);
        setCapabilities(null);
        throw err;
      } finally {
        setIsLoadingCapabilities(false);
      }
    },
    [baseUrl, token]
  );

  // Sync with auth storage
  useEffect(() => {
    const unsubscribe = subscribeAuthChange(() => {
      const currentToken = getStoredApiToken();
      const currentUrl = getStoredApiBaseUrl();
      setToken(currentToken);
      setBaseUrl(currentUrl);

      if (currentToken) {
        fetchCapabilities(currentUrl, currentToken).catch(() => {});
      } else {
        setCapabilities(null);
        setCapabilitiesError(null);
      }
    });

    // Initial load
    if (token) {
      fetchCapabilities(baseUrl, token).catch(() => {});
    }

    return unsubscribe;
  }, [fetchCapabilities]);

  const connect = async (newToken: string, newBaseUrl?: string): Promise<CapabilitiesResponse> => {
    const cleanToken = newToken.trim();
    const cleanUrl = (newBaseUrl || baseUrl).trim().replace(/\/+$/, '');

    // Attempt capabilities fetch before committing session
    const caps = await fetchCapabilities(cleanUrl, cleanToken);
    setApiSession(cleanToken, cleanUrl);
    return caps;
  };

  const disconnect = () => {
    clearApiSession();
    setCapabilities(null);
    setCapabilitiesError(null);
  };

  const refreshCapabilities = async () => {
    if (token) {
      await fetchCapabilities(baseUrl, token);
    }
  };

  const isConnected = Boolean(token && capabilities && !capabilitiesError);

  return (
    <ConnectionContext.Provider
      value={{
        baseUrl,
        token,
        isConnected,
        capabilities,
        isLoadingCapabilities,
        capabilitiesError,
        connect,
        disconnect,
        refreshCapabilities,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
}
