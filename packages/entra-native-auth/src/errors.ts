import {
  AuthError,
  type AuthErrorCode,
} from '@franciscodlxdev/vue-native-auth-core';

export interface RequiredAttribute {
  name: string;
  type?: string;
  required?: boolean;
  options?: { regex?: string };
}

export interface EntraErrorBody {
  error?: string;
  error_description?: string;
  error_codes?: number[];
  suberror?: string;
  continuation_token?: string;
  invalid_attributes?: { name: string }[];
  required_attributes?: RequiredAttribute[];
  trace_id?: string;
  correlation_id?: string;
}

/**
 * An error answered by the native authentication API. `providerError` is
 * Entra's `error` (e.g. `user_not_found`, `invalid_grant`) and `suberror`
 * narrows it down (e.g. `invalid_oob_value`, `password_too_weak`).
 */
export class EntraAuthError extends AuthError {
  readonly suberror?: string;
  readonly errorCodes: number[];
  readonly invalidAttributes: string[];
  /** For support requests to Microsoft. */
  readonly traceId?: string;
  readonly correlationId?: string;

  constructor(
    code: AuthErrorCode,
    message: string,
    body: EntraErrorBody = {},
    status?: number
  ) {
    super(code, message, {
      providerError: body.error,
      providerErrorDescription: body.error_description,
      status,
    });
    this.name = 'EntraAuthError';
    this.suberror = body.suberror;
    this.errorCodes = body.error_codes ?? [];
    this.invalidAttributes = (body.invalid_attributes ?? []).map(
      (attribute) => attribute.name
    );
    this.traceId = body.trace_id;
    this.correlationId = body.correlation_id;
  }

  /** `user_not_found`, `invalid_grant:invalid_oob_value`, … for a `switch`. */
  get reason(): string {
    return [this.providerError, this.suberror].filter(Boolean).join(':');
  }
}

export function isEntraAuthError(error: unknown): error is EntraAuthError {
  return error instanceof EntraAuthError;
}
