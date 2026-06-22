export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toEnvelope(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}
