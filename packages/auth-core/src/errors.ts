/**
 * Error codes shared by every plugin of the family, so apps handle failures
 * the same way no matter the provider.
 */
export type AuthErrorCode =
  | 'CANCELLED'
  | 'NETWORK'
  | 'INVALID_CONFIG'
  | 'PROVIDER_ERROR'
  | 'NOT_SUPPORTED';

const CODES: readonly AuthErrorCode[] = [
  'CANCELLED',
  'NETWORK',
  'INVALID_CONFIG',
  'PROVIDER_ERROR',
  'NOT_SUPPORTED',
];

export interface AuthErrorDetails {
  /** `error` returned by the provider (RFC 6749 §4.1.2.1 / §5.2), if any. */
  providerError?: string;
  /** `error_description` returned by the provider, if any. */
  providerErrorDescription?: string;
  /** HTTP status of the failed token/userinfo request, if any. */
  status?: number;
  cause?: unknown;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly providerError?: string;
  readonly providerErrorDescription?: string;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    code: AuthErrorCode,
    message: string,
    details: AuthErrorDetails = {}
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.providerError = details.providerError;
    this.providerErrorDescription = details.providerErrorDescription;
    this.status = details.status;
    this.cause = details.cause;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/** Normalizes anything thrown by the native module or `fetch` into an AuthError. */
export function toAuthError(
  error: unknown,
  fallback: AuthErrorCode = 'PROVIDER_ERROR'
): AuthError {
  if (error instanceof AuthError) {
    return error;
  }
  const raw = error as { code?: unknown; message?: unknown } | null | undefined;
  const code = CODES.find((c) => c === raw?.code) ?? fallback;
  const message =
    typeof raw?.message === 'string' && raw.message.length > 0
      ? raw.message
      : 'Authentication failed';
  return new AuthError(code, message, { cause: error });
}
