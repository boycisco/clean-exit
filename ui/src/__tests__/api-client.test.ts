import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiClient, ApiError, request } from '../lib/api-client.ts';
import { setApiSession, clearApiSession, getStoredApiToken } from '../lib/auth-storage.ts';

describe('Clean Exit API Client & Auth', () => {
  beforeEach(() => {
    clearApiSession();
    vi.restoreAllMocks();
  });

  it('attaches Bearer token in Authorization header to private requests', async () => {
    const mockToken = 'ce_test_token_1234567890';
    setApiSession(mockToken, 'http://127.0.0.1:8000');

    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      capturedHeaders = new Headers(init.headers);
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 'agent-1', name: 'agent-one', status: 'active' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const agents = await apiClient.listAgents();
    expect(capturedHeaders?.get('Authorization')).toBe(`Bearer ${mockToken}`);
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('agent-one');
  });

  it('correctly parses structured error envelopes with error.code and details', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'signer_unavailable',
            message: 'No signer key configured for destructive actions.',
            details: {},
            request_id: 'req-uuid-test',
          },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await apiClient.createTerminationJob('agent-1', { reason: 'test' });
      expect.fail('Should have thrown ApiError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('signer_unavailable');
      expect(apiErr.httpStatus).toBe(503);
      expect(apiErr.requestId).toBe('req-uuid-test');
    }
  });

  it('resets session and clears token on 401 Unauthorized', async () => {
    setApiSession('ce_invalid_token');
    expect(getStoredApiToken()).toBe('ce_invalid_token');

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'unauthorized',
            message: 'Token has been revoked.',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await apiClient.listAgents();
    } catch {
      // expected error
    }

    expect(getStoredApiToken()).toBeNull();
  });

  it('handles 404 for Priority 4c receipt endpoints gracefully without crashing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'not_found',
            message: 'Receipt not found or not yet implemented.',
          },
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const receipt = await apiClient.getReceipt('non-existent-id');
    expect(receipt).toBeNull();
  });
});
