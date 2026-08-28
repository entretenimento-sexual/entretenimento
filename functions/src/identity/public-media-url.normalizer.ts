// functions/src/identity/public-media-url.normalizer.ts
// -----------------------------------------------------------------------------
// PUBLIC IDENTITY MEDIA URL NORMALIZATION
// -----------------------------------------------------------------------------
// Regra canônica para URLs de mídia usadas na identidade pública. Produção
// permanece HTTPS-only; HTTP é aceito exclusivamente em loopback para suportar
// Firebase Emulator sem ampliar a superfície para mídia insegura externa.
// -----------------------------------------------------------------------------

const MAX_PUBLIC_MEDIA_URL_LENGTH = 2_048;

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function normalizePublicIdentityMediaUrl(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > MAX_PUBLIC_MEDIA_URL_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'https:') return parsed.toString();
    if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}
