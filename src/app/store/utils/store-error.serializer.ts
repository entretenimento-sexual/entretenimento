//src\app\store\utils\store-error.serializer.ts
import { IError } from '@core/interfaces/ierror';

export const toStoreError = (
  err: unknown,
  fallbackMsg: string,
  context: string,
  extra?: Record<string, unknown>
): IError => {
  const anyErr = err as any;

  const message =
    (typeof anyErr?.message === 'string' && anyErr.message) ||
    (typeof anyErr === 'string' && anyErr) ||
    fallbackMsg;

  const rawCode = anyErr?.code;

  let code: number | undefined;
  if (typeof rawCode === 'number') code = rawCode;
  else if (typeof rawCode === 'string') {
    const n = Number(rawCode);
    if (Number.isFinite(n)) code = n;
  }

  const firebaseCode = typeof rawCode === 'string' ? rawCode : undefined;
  const stack = typeof anyErr?.stack === 'string' ? anyErr.stack : undefined;

  return {
    message,
    code,
    severity: 'error',
    context,
    extra: { ...(extra ?? {}), ...(firebaseCode ? { firebaseCode } : {}) },
    stack,
    timestamp: new Date().toISOString(),
  };
};
