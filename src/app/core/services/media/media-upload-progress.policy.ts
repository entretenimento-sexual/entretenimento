export function normalizeMediaUploadProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export function mapMediaUploadProgress(
  value: number,
  start: number,
  end: number
): number {
  const safeStart = normalizeMediaUploadProgress(start);
  const safeEnd = normalizeMediaUploadProgress(end);
  const lower = Math.min(safeStart, safeEnd);
  const upper = Math.max(safeStart, safeEnd);
  const ratio = normalizeMediaUploadProgress(value) / 100;
  const mapped = Math.round(safeStart + (safeEnd - safeStart) * ratio);

  return Math.max(lower, Math.min(upper, mapped));
}
