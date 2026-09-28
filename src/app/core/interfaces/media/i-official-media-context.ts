export const OFFICIAL_MEDIA_CONTEXT_TARGET_TYPES = [
  'profile',
  'organization',
  'venue',
  'event',
] as const;

export type TOfficialMediaContextTargetType =
  typeof OFFICIAL_MEDIA_CONTEXT_TARGET_TYPES[number];

export interface IOfficialMediaContextEntry {
  readonly identity: {
    readonly verified: true;
    readonly type: TOfficialMediaContextTargetType;
  };
  readonly association: {
    readonly verified: true;
  };
  readonly target: {
    readonly type: TOfficialMediaContextTargetType;
    readonly id: string;
  };
}

export interface IOfficialMediaContextProjection {
  readonly contexts: readonly IOfficialMediaContextEntry[];
}
