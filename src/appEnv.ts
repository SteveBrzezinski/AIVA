function normalizeEnvFlag(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

function normalizeBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().replace(/\/+$/, '');
  return normalized || fallback;
}

export const DEBUG_NAV_ENABLED = normalizeEnvFlag(import.meta.env.DEBUG);
export const DEFAULT_HOSTED_BACKEND_URL = normalizeBaseUrl(
  import.meta.env.BACKEND_URL,
  'http://localhost',
);
