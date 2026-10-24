/**
 * Clean Exit API Client
 * Centralized, strongly typed HTTP client matching the api.md contract.
 */

import {
  getStoredApiToken,
  getStoredApiBaseUrl,
  clearApiSession,
} from './auth-storage.ts';
import type {
  CapabilitiesResponse,
  Agent,
  AgentCreateInput,
  AgentUpdateInput,
  AgentStatus,
  Authority,
  AuthorityCreateInput,
  AuthorityUpdateInput,
  AuthorityGraphResponse,
  VerifyResponse,
  TerminationPlan,
  TerminationJob,
  TerminationRequestInput,
  Receipt,
  ReceiptVerifyResponse,
  AuditEvent,
  ApiErrorEnvelope,
} from '../types/api.ts';

export class ApiError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details: Record<string, unknown>;
  public readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    details: Record<string, unknown> = {},
    requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  customToken?: string;
  customBaseUrl?: string;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const baseUrl = options.customBaseUrl || getStoredApiBaseUrl();
  const token = options.customToken ?? getStoredApiToken();

  const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (!options.skipAuth && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Network connection failure';
    throw new ApiError(
      'connection_failure',
      `Unable to reach Clean Exit backend at ${baseUrl}. Ensure the server is running and accessible. (${errorMsg})`,
      0
    );
  }

  const requestId =
    response.headers.get('x-request-id') || response.headers.get('X-Request-ID') || undefined;

  // Handle 204 No Content
  if (response.status === 204) {
    return null as unknown as T;
  }

  // Parse JSON or text
  const contentType = response.headers.get('content-type') || '';
  let data: unknown = null;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    // 401 Unauthorized handling: reset session if token was rejected
    if (response.status === 401) {
      clearApiSession();
    }

    if (
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as ApiErrorEnvelope).error === 'object'
    ) {
      const envelope = data as ApiErrorEnvelope;
      throw new ApiError(
        envelope.error.code || 'unknown_error',
        envelope.error.message || `Request failed with status ${response.status}`,
        response.status,
        envelope.error.details || {},
        envelope.error.request_id || requestId
      );
    }

    // FastAPI default detail object fallback: e.g. {"detail": "..."} or {"error": "..."}
    let fallbackMsg = `Request failed with status ${response.status}`;
    let fallbackCode = 'request_failed';

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (typeof record.detail === 'string') {
        fallbackMsg = record.detail;
      } else if (typeof record.error === 'string') {
        fallbackMsg = record.error;
      } else if (Array.isArray(record.detail)) {
        fallbackMsg = 'Validation failed';
        fallbackCode = 'validation_error';
      }
    }

    if (response.status === 401) fallbackCode = 'unauthorized';
    else if (response.status === 404) fallbackCode = 'not_found';
    else if (response.status === 409) fallbackCode = 'conflict';
    else if (response.status === 422) fallbackCode = 'validation_error';
    else if (response.status === 429) fallbackCode = 'rate_limited';
    else if (response.status === 502) fallbackCode = 'rpc_unavailable';
    else if (response.status === 503) fallbackCode = 'signer_unavailable';

    throw new ApiError(
      fallbackCode,
      fallbackMsg,
      response.status,
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
      requestId
    );
  }

  return data as T;
}

export const apiClient = {
  // Discovery & Health
  async getHealth(customBaseUrl?: string): Promise<{ status: string; timestamp?: string }> {
    return request<{ status: string; timestamp?: string }>('/health', {
      skipAuth: true,
      customBaseUrl,
    });
  },

  async getCapabilities(customBaseUrl?: string, customToken?: string): Promise<CapabilitiesResponse> {
    return request<CapabilitiesResponse>('/api/v1/capabilities', {
      skipAuth: false,
      customBaseUrl,
      customToken,
    });
  },

  // Agents
  async listAgents(params?: {
    status?: AgentStatus;
    limit?: number;
    offset?: number;
  }): Promise<Agent[]> {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.limit !== undefined) search.set('limit', String(params.limit));
    if (params?.offset !== undefined) search.set('offset', String(params.offset));

    const query = search.toString();
    return request<Agent[]>(`/api/v1/agents${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  },

  async createAgent(input: AgentCreateInput): Promise<Agent> {
    return request<Agent>('/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getAgent(agentId: string): Promise<Agent> {
    return request<Agent>(`/api/v1/agents/${agentId}`, {
      method: 'GET',
    });
  },

  async updateAgent(agentId: string, input: AgentUpdateInput): Promise<Agent> {
    return request<Agent>(`/api/v1/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  // Authorities
  async getAuthorityGraph(agentId: string): Promise<AuthorityGraphResponse> {
    return request<AuthorityGraphResponse>(`/api/v1/agents/${agentId}/authorities`, {
      method: 'GET',
    });
  },

  async registerAuthority(
    agentId: string,
    input: AuthorityCreateInput
  ): Promise<Authority> {
    return request<Authority>(`/api/v1/agents/${agentId}/authorities`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getAuthority(authorityId: string): Promise<Authority> {
    return request<Authority>(`/api/v1/authorities/${authorityId}`, {
      method: 'GET',
    });
  },

  async updateAuthority(
    authorityId: string,
    input: AuthorityUpdateInput
  ): Promise<Authority> {
    return request<Authority>(`/api/v1/authorities/${authorityId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async verifyAuthorities(agentId: string): Promise<VerifyResponse> {
    return request<VerifyResponse>(`/api/v1/agents/${agentId}/verify`, {
      method: 'POST',
    });
  },

  // Termination
  async getTerminationPlan(agentId: string): Promise<TerminationPlan> {
    return request<TerminationPlan>(`/api/v1/agents/${agentId}/termination-plan`, {
      method: 'GET',
    });
  },

  async createTerminationJob(
    agentId: string,
    input: TerminationRequestInput
  ): Promise<TerminationJob> {
    return request<TerminationJob>(`/api/v1/agents/${agentId}/terminate`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getTerminationJob(jobId: string): Promise<TerminationJob> {
    return request<TerminationJob>(`/api/v1/terminations/${jobId}`, {
      method: 'GET',
    });
  },

  async listTerminationJobs(agentId: string): Promise<TerminationJob[]> {
    return request<TerminationJob[]>(`/api/v1/agents/${agentId}/terminations`, {
      method: 'GET',
    });
  },

  async retryTerminationJob(jobId: string): Promise<TerminationJob> {
    return request<TerminationJob>(`/api/v1/terminations/${jobId}/retry`, {
      method: 'POST',
    });
  },

  // Receipts (Gracefully handles 404 for Priority 4c)
  async getReceipt(receiptId: string): Promise<Receipt | null> {
    try {
      return await request<Receipt>(`/api/v1/receipts/${receiptId}`, {
        method: 'GET',
      });
    } catch (err) {
      if (err instanceof ApiError && err.httpStatus === 404) {
        return null;
      }
      throw err;
    }
  },

  async verifyReceipt(receiptId: string): Promise<ReceiptVerifyResponse | null> {
    try {
      return await request<ReceiptVerifyResponse>(`/api/v1/receipts/${receiptId}/verify`, {
        method: 'GET',
      });
    } catch (err) {
      if (err instanceof ApiError && err.httpStatus === 404) {
        return null;
      }
      throw err;
    }
  },

  async publishReceipt(receiptId: string): Promise<{
    receipt_id: string;
    verification_status: string;
    onchain_tx_hash: string | null;
    published_at: string | null;
    detail: string | null;
    error: string | null;
  }> {
    return request(`/api/v1/receipts/${receiptId}/publish`, {
      method: 'POST',
    });
  },

  async getAgentReceipt(agentId: string): Promise<Receipt | null> {
    try {
      return await request<Receipt>(`/api/v1/agents/${agentId}/receipt`, {
        method: 'GET',
      });
    } catch (err) {
      if (err instanceof ApiError && err.httpStatus === 404) {
        return null;
      }
      throw err;
    }
  },

  // Audit
  async getAuditTrail(
    agentId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<AuditEvent[]> {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set('limit', String(params.limit));
    if (params?.offset !== undefined) search.set('offset', String(params.offset));

    const query = search.toString();
    return request<AuditEvent[]>(
      `/api/v1/agents/${agentId}/audit${query ? `?${query}` : ''}`,
      {
        method: 'GET',
      }
    );
  },
};
