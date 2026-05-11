export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  scope: string
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

export function log(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    scope,
    message,
    details,
    timestamp: new Date().toISOString(),
  }

  console[level](`[${entry.timestamp}] [${scope}] ${message}`, details ?? {})
}
