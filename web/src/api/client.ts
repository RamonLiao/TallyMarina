/// <reference types="vite/client" />
import type { ApiError } from './types';

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787';

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

function isEnvelope(x: unknown): x is ApiError {
  return (
    typeof x === 'object' && x !== null && 'error' in x &&
    typeof (x as ApiError).error?.code === 'string'
  );
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }

  if (!res.ok) {
    if (isEnvelope(body)) throw new ApiClientError(body.error.code, body.error.message, res.status);
    throw new ApiClientError('HTTP_ERROR', `HTTP ${res.status}`, res.status);
  }
  return body as T;
}
