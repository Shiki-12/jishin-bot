const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Dapatkan level logging aktif dari process.env.LOG_LEVEL.
 */
export function getActiveLogLevel() {
  const envLevel = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

const SENSITIVE_KEY_REGEX = /api[-_]?key|token|password|secret|authorization|bearer|auth/i;

/**
 * Bersihkan data sensitif (API key, token, sandi) sebelum ditulis ke log.
 */
export function sanitize(data) {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return data
      .replace(/Bearer\s+[A-Za-z0-9_\-\.]{8,}/gi, 'Bearer ***')
      .replace(/(?:api[-_]?key|token|secret)[=:]\s*['"]?[A-Za-z0-9_\-\.]{8,}['"]?/gi, '$1=***');
  }

  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(sanitize);
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      clean[key] = '***';
    } else {
      clean[key] = sanitize(value);
    }
  }
  return clean;
}

/**
 * Format string log satu baris terstruktur.
 */
export function formatLog(level, message, meta) {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta !== undefined && meta !== null) {
    const cleanMeta = sanitize(meta);
    line += ` ${typeof cleanMeta === 'object' ? JSON.stringify(cleanMeta) : cleanMeta}`;
  }
  return line;
}

/**
 * Logger terstruktur satu baris dengan penyaringan otomatis data sensitif.
 */
export const logger = {
  debug(message, meta) {
    if (getActiveLogLevel() <= LOG_LEVELS.debug) {
      console.log(formatLog('DEBUG', message, meta));
    }
  },
  info(message, meta) {
    if (getActiveLogLevel() <= LOG_LEVELS.info) {
      console.log(formatLog('INFO', message, meta));
    }
  },
  warn(message, meta) {
    if (getActiveLogLevel() <= LOG_LEVELS.warn) {
      console.warn(formatLog('WARN', message, meta));
    }
  },
  error(message, meta) {
    if (getActiveLogLevel() <= LOG_LEVELS.error) {
      console.error(formatLog('ERROR', message, meta));
    }
  },
};

