export function logInfo(
  source: string,
  message: string,
  context?: Record<string, unknown>
) {
  console.log(JSON.stringify({ level: "info", source, message, context }));
}

export function logError(
  source: string,
  error: unknown,
  message: string,
  context?: Record<string, unknown>
) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      level: "error",
      source,
      message,
      error: errorMessage,
      context,
    })
  );
}
