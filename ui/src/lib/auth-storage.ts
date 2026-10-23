/**
 * Session-scoped operator credential and API URL storage.
 * In accordance with Clean Exit security guidelines:
 * - Tokens are NEVER written to localStorage.
 * - Tokens are stored only in memory and optionally sessionStorage for tab survival.
 * - Tokens are never logged.
 * - An explicit disconnect clears all state.
 */

const SESSION_TOKEN_KEY = 'cleanexit_session_token';
const SESSION_URL_KEY = 'cleanexit_session_base_url';

export const DEFAULT_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string) || 'http://127.0.0.1:8000';

type AuthListener = () => void;
const listeners: Set<AuthListener> = new Set();

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
}

// In-memory fallback
let memoryToken: string | null = null;
let memoryBaseUrl: string = DEFAULT_API_BASE_URL;

// Initialize from sessionStorage if present
try {
  const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (savedToken) {
    memoryToken = savedToken;
  }
  const savedUrl = sessionStorage.getItem(SESSION_URL_KEY);
  if (savedUrl) {
    memoryBaseUrl = savedUrl;
  }
} catch {
  // sessionStorage unavailable in some sandboxes
}

export function getStoredApiToken(): string | null {
  return memoryToken;
}

export function getStoredApiBaseUrl(): string {
  return memoryBaseUrl;
}

export function setApiSession(token: string, baseUrl?: string): void {
  const sanitizedToken = token.trim();
  memoryToken = sanitizedToken;
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, sanitizedToken);
  } catch {
    // Ignore
  }

  if (baseUrl) {
    const cleanUrl = baseUrl.trim().replace(/\/+$/, '');
    memoryBaseUrl = cleanUrl;
    try {
      sessionStorage.setItem(SESSION_URL_KEY, cleanUrl);
    } catch {
      // Ignore
    }
  }

  notifyListeners();
}

export function updateApiBaseUrl(baseUrl: string): void {
  const cleanUrl = baseUrl.trim().replace(/\/+$/, '');
  memoryBaseUrl = cleanUrl;
  try {
    sessionStorage.setItem(SESSION_URL_KEY, cleanUrl);
  } catch {
    // Ignore
  }
  notifyListeners();
}

export function clearApiSession(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore
  }
  notifyListeners();
}

export function subscribeAuthChange(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
