/**
 * Error sanitization utilities
 * 
 * Prevents sensitive information (tokens, passwords, API keys, connection strings)
 * from being leaked in error logs.
 */

/**
 * Patterns that indicate sensitive data (should be redacted)
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
  /database[_-]?url/i,
  /postgres/i,
  /jwt/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /private[_-]?key/i,
  /encryption[_-]?key/i,
];

/**
 * Redacts sensitive values from strings
 * Replaces sensitive patterns with [REDACTED]
 */
function redactSensitiveValues(value: string): string {
  let redacted = value;
  
  // Check for common sensitive patterns in the value itself
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(value)) {
      // Replace the entire value if it looks sensitive
      return "[REDACTED]";
    }
  }
  
  return redacted;
}

/**
 * Recursively sanitizes an object, redacting sensitive fields
 */
function sanitizeObject(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return "[MAX_DEPTH_REACHED]";
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitives
  if (typeof obj !== "object") {
    if (typeof obj === "string") {
      return redactSensitiveValues(obj);
    }
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  // Handle objects
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Check if the key itself indicates sensitive data
    const isSensitiveKey = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
    
    if (isSensitiveKey) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      sanitized[key] = redactSensitiveValues(value);
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Sanitizes an error object for safe logging
 * 
 * Only includes safe properties:
 * - name (error type)
 * - message (error message - sanitized)
 * - stack (stack trace - sanitized)
 * - code (error code if present)
 * 
 * Excludes potentially sensitive properties like:
 * - Database connection details
 * - API keys/tokens
 * - Full error objects that might contain sensitive data
 */
export function sanitizeErrorForLogging(error: unknown): {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveValues(error.message),
      stack: error.stack ? redactSensitiveValues(error.stack) : undefined,
      code: (error as any).code,
    };
  }
  
  // For non-Error objects, convert to string and sanitize
  const stringValue = String(error);
  return {
    message: redactSensitiveValues(stringValue),
  };
}

/**
 * Sanitizes a value for logging
 * Useful for logging request bodies, error details, etc.
 */
export function sanitizeForLogging(value: unknown): unknown {
  return sanitizeObject(value);
}
