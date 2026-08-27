export interface IPublicMediaContinuationContext {
  readonly connectionOwnerUids: readonly string[];
  readonly compatibleOwnerUids: readonly string[];
}

export const EMPTY_PUBLIC_MEDIA_CONTINUATION_CONTEXT:
  IPublicMediaContinuationContext = Object.freeze({
    connectionOwnerUids: [],
    compatibleOwnerUids: [],
  });
