/**
 * Standardized API error response utility
 * 
 * Provides consistent error format across all API endpoints for:
 * - Better developer experience
 * - Easier debugging and monitoring
 * - Consistent client-side error handling
 */

/**
 * Patterns that indicate sensitive data (should be redacted from logs)
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /key/i,
  /auth/i,
  /credential/i,
  /bearer/i,
  /api[_-]?key/i,
  /connection[_-]?string/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /private[_-]?key/i,
  /encryption[_-]?key/i,
];

/**
 * Sanitizes details object to prevent sensitive data leakage in logs
 * 
 * @param details - Object to sanitize
 * @returns Sanitized object with sensitive values redacted
 */
function sanitizeDetails(details: any): any {
  if (!details || typeof details !== 'object') {
    return details;
  }

  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(details)) {
    // Check if key or value indicates sensitive data
    const isSensitiveKey = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
    
    if (isSensitiveKey) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === 'string') {
      // Check if value itself contains sensitive patterns
      const isSensitiveValue = SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
      sanitized[key] = isSensitiveValue ? "[REDACTED]" : value;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeDetails(value); // Recursive
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export type ErrorCode = 
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED" 
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "DATABASE_ERROR"
  | "PAYMENT_ERROR"
  | "SCHEDULING_ERROR"
  | "ENCRYPTION_ERROR";

export interface ApiError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
    errorId: string;
    timestamp: string;
  };
}

export interface ApiSuccess<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

export interface ApiSuccessWithPagination<T = any> extends ApiSuccess<T[]> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

/**
 * Creates a standardized API error response
 */
export function createApiError(
  code: ErrorCode,
  message: string,
  status: number = 500,
  options?: {
    details?: any;
    errorId?: string;
  }
): { response: ApiError; status: number } {
  const errorId = options?.errorId || generateErrorId();
  
  const errorResponse: ApiError = {
    success: false,
    error: {
      code,
      message,
      details: options?.details,
      errorId,
      timestamp: new Date().toISOString(),
    },
  };

  // Log error for debugging
  console.error(`API Error [${errorId}]: ${code} - ${message}`, {
    code,
    errorId,
    details: options?.details ? sanitizeDetails(options.details) : undefined,
  });

  return { response: errorResponse, status };
}

/**
 * Creates a standardized API success response
 */
export function createApiSuccess<T>(
  data: T,
  message?: string
): ApiSuccess<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a standardized API success response with pagination metadata
 * 
 * @param data - Array of data items
 * @param pagination - Pagination metadata
 * @param message - Optional success message
 * @returns Paginated success response
 */
export function createApiSuccessWithPagination<T>(
  data: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore?: boolean;
  },
  message?: string
): ApiSuccessWithPagination<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
    pagination: {
      ...pagination,
      hasMore: pagination.hasMore ?? (pagination.page * pagination.limit < pagination.total),
    },
  };
}

/**
 * Helper functions for common error scenarios
 */

export function validationError(message: string, details?: any) {
  return createApiError("VALIDATION_ERROR", message, 400, { details });
}

export function unauthorized(message: string = "Authentication required") {
  return createApiError("UNAUTHORIZED", message, 401);
}

export function forbidden(message: string = "Access denied") {
  return createApiError("FORBIDDEN", message, 403);
}

export function notFound(resource: string = "Resource") {
  return createApiError("NOT_FOUND", `${resource} not found`, 404);
}

export function conflict(message: string, details?: any) {
  return createApiError("CONFLICT", message, 409, { details });
}

/**
 * Creates a rate limit error response with optional retry header
 * 
 * @param message - Error message
 * @param retryAfter - Seconds until the request can be retried
 * @returns Error response with Retry-After header if retryAfter provided
 */
export function rateLimited(
  message: string = "Too many requests",
  retryAfter?: number
) {
  const headers: Record<string, string> = {};
  if (retryAfter !== undefined) {
    headers['Retry-After'] = retryAfter.toString();
  }

  const error = createApiError("RATE_LIMITED", message, 429);
  
  return { 
    ...error,
    headers: headers as HeadersInit,
  };
}

export function internalError(message: string = "Internal server error", details?: any) {
  return createApiError("INTERNAL_ERROR", message, 500, { details });
}

export function externalServiceError(service: string, message?: string) {
  return createApiError(
    "EXTERNAL_SERVICE_ERROR", 
    `${service} service error: ${message || "Unknown error"}`, 
    502
  );
}

export function databaseError(message: string = "Database operation failed") {
  return createApiError("DATABASE_ERROR", message, 500);
}

export function paymentError(message: string = "Payment processing failed") {
  return createApiError("PAYMENT_ERROR", message, 402);
}

export function schedulingError(message: string = "Scheduling operation failed") {
  return createApiError("SCHEDULING_ERROR", message, 400);
}

export function encryptionError(message: string = "Encryption/decryption failed") {
  return createApiError("ENCRYPTION_ERROR", message, 500);
}

/**
 * Generates a unique error ID for tracking
 */
function generateErrorId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Wraps API handlers with standardized error handling
 */
export function withErrorHandler<T extends any[]>(
  handler: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error('Unhandled API error:', error);
      
      const errorId = generateErrorId();
      const { response: errorResponse } = internalError(
        "An unexpected error occurred",
        { errorId }
      );
      
      return Response.json(errorResponse, { status: 500 });
    }
  };
}

/**
 * Maps HTTP status codes to error codes
 */
export function getErrorCodeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400: return "VALIDATION_ERROR";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 429: return "RATE_LIMITED";
    case 500: return "INTERNAL_ERROR";
    case 502: return "EXTERNAL_SERVICE_ERROR";
    default: return "INTERNAL_ERROR";
  }
}