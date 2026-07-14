export interface VideoPublicationSettingsInput {
  title?: unknown;
  description?: unknown;
  reactionsEnabled?: unknown;
  commentsEnabled?: unknown;
  ratingsEnabled?: unknown;
}

export interface VideoPublicationSettings {
  title: string | null;
  description: string | null;
  reactionsEnabled: boolean;
  commentsEnabled: boolean;
  ratingsEnabled: boolean;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return normalized || null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeVideoPublicationSettings(
  input: VideoPublicationSettingsInput | null | undefined,
  defaults: Partial<VideoPublicationSettings> = {}
): VideoPublicationSettings {
  return {
    title: cleanText(input?.title ?? defaults.title, 120),
    description: cleanText(input?.description ?? defaults.description, 1000),
    reactionsEnabled: normalizeBoolean(
      input?.reactionsEnabled,
      defaults.reactionsEnabled ?? true
    ),
    commentsEnabled: normalizeBoolean(
      input?.commentsEnabled,
      defaults.commentsEnabled ?? true
    ),
    ratingsEnabled: normalizeBoolean(
      input?.ratingsEnabled,
      defaults.ratingsEnabled ?? true
    ),
  };
}

export function hasVideoPublicationTextChanged(
  previous: VideoPublicationSettings,
  next: VideoPublicationSettings
): boolean {
  return previous.title !== next.title ||
    previous.description !== next.description;
}
