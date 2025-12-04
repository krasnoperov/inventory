/**
 * Structured Logger
 *
 * Provides consistent logging with request ID correlation across the codebase.
 * Outputs JSON format for easy log aggregation and analysis.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  /** Request ID for correlation */
  requestId?: string;
  /** Space ID context */
  spaceId?: string;
  /** User ID context */
  userId?: string;
  /** Additional structured data */
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  durationMs?: number;
}

/**
 * Create a logger for a specific component
 */
export function createLogger(component: string) {
  const log = (level: LogLevel, message: string, context?: LogContext, error?: Error) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Format output with request ID prefix for easy filtering
    const prefix = context?.requestId ? `[${context.requestId}]` : '';
    const formatted = `[${component}]${prefix} ${message}`;

    // In development, use readable format; in production, use JSON
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      switch (level) {
        case 'debug':
          console.debug(formatted, context || '');
          break;
        case 'info':
          console.log(formatted, context || '');
          break;
        case 'warn':
          console.warn(formatted, context || '');
          break;
        case 'error':
          console.error(formatted, error || context || '');
          break;
      }
    } else {
      // JSON format for production
      const output = level === 'error' ? console.error : console.log;
      output(JSON.stringify(entry));
    }
  };

  return {
    debug: (message: string, context?: LogContext) => log('debug', message, context),
    info: (message: string, context?: LogContext) => log('info', message, context),
    warn: (message: string, context?: LogContext) => log('warn', message, context),
    error: (message: string, context?: LogContext, error?: Error) => log('error', message, context, error),

    /**
     * Create a child logger with additional context
     */
    child: (additionalContext: LogContext) => {
      return {
        debug: (message: string, context?: LogContext) =>
          log('debug', message, { ...additionalContext, ...context }),
        info: (message: string, context?: LogContext) =>
          log('info', message, { ...additionalContext, ...context }),
        warn: (message: string, context?: LogContext) =>
          log('warn', message, { ...additionalContext, ...context }),
        error: (message: string, context?: LogContext, error?: Error) =>
          log('error', message, { ...additionalContext, ...context }, error),
      };
    },

    /**
     * Log with timing - returns a function to call when operation completes
     */
    startTimer: (operation: string, context?: LogContext) => {
      const start = Date.now();
      log('debug', `${operation} started`, context);
      return (success = true, additionalContext?: LogContext) => {
        const durationMs = Date.now() - start;
        const level = success ? 'info' : 'error';
        log(level, `${operation} ${success ? 'completed' : 'failed'}`, {
          ...context,
          ...additionalContext,
          durationMs,
        });
      };
    },
  };
}

/**
 * Pre-configured loggers for common components
 */
export const loggers = {
  // Durable Object
  spaceDO: createLogger('SpaceDO'),
  authHandler: createLogger('AuthHandler'),
  spaceRepository: createLogger('SpaceRepository'),

  // Controllers
  approvalController: createLogger('ApprovalController'),
  assetController: createLogger('AssetController'),
  chatController: createLogger('ChatController'),
  generationController: createLogger('GenerationController'),
  lineageController: createLogger('LineageController'),
  planController: createLogger('PlanController'),
  presenceController: createLogger('PresenceController'),
  sessionController: createLogger('SessionController'),
  syncController: createLogger('SyncController'),
  variantController: createLogger('VariantController'),
  visionController: createLogger('VisionController'),

  // Workflows
  chatWorkflow: createLogger('ChatWorkflow'),
  generationWorkflow: createLogger('GenerationWorkflow'),

  // Services
  claudeService: createLogger('ClaudeService'),
  geminiService: createLogger('GeminiService'),

  // Internal API
  internalApi: createLogger('InternalApi'),
};
