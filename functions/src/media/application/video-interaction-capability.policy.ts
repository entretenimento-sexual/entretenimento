import { HttpsError } from 'firebase-functions/v2/https';

export type VideoInteractionCapability = 'REACTION' | 'COMMENT' | 'RATING';

export type VideoInteractionCapabilityReason =
  | 'settings_inconsistent'
  | 'interaction_disabled';

export type VideoInteractionCapabilityDocument = Readonly<
  Record<string, unknown>
>;

export interface VideoInteractionCapabilityDecision {
  readonly allowed: boolean;
  readonly reason: VideoInteractionCapabilityReason | null;
}

type VideoInteractionCapabilityField =
  | 'reactionsEnabled'
  | 'commentsEnabled'
  | 'ratingsEnabled';

function capabilityField(
  capability: VideoInteractionCapability
): VideoInteractionCapabilityField {
  switch (capability) {
  case 'REACTION':
    return 'reactionsEnabled';
  case 'COMMENT':
    return 'commentsEnabled';
  case 'RATING':
    return 'ratingsEnabled';
  }
}

function capabilityLabel(capability: VideoInteractionCapability): string {
  switch (capability) {
  case 'REACTION':
    return 'Curtidas';
  case 'COMMENT':
    return 'Comentários';
  case 'RATING':
    return 'Avaliações';
  }
}

export function evaluateVideoInteractionCapability(params: {
  readonly capability: VideoInteractionCapability;
  readonly publicVideo: VideoInteractionCapabilityDocument;
  readonly publication: VideoInteractionCapabilityDocument;
}): VideoInteractionCapabilityDecision {
  const field = capabilityField(params.capability);
  const projectionEnabled = params.publicVideo[field] === true;
  const publicationEnabled = params.publication[field] === true;

  if (projectionEnabled !== publicationEnabled) {
    return {
      allowed: false,
      reason: 'settings_inconsistent',
    };
  }

  if (!projectionEnabled) {
    return {
      allowed: false,
      reason: 'interaction_disabled',
    };
  }

  return { allowed: true, reason: null };
}

export function assertVideoInteractionCapability(params: {
  readonly capability: VideoInteractionCapability;
  readonly publicVideo: VideoInteractionCapabilityDocument;
  readonly publication: VideoInteractionCapabilityDocument;
}): void {
  const decision = evaluateVideoInteractionCapability(params);

  if (decision.allowed) {
    return;
  }

  const details = {
    capability: params.capability,
    reason: decision.reason,
  };

  if (decision.reason === 'settings_inconsistent') {
    throw new HttpsError(
      'failed-precondition',
      'As configurações de interação deste vídeo estão sendo atualizadas. Tente novamente.',
      details
    );
  }

  throw new HttpsError(
    'failed-precondition',
    `${capabilityLabel(params.capability)} desabilitadas neste vídeo.`,
    details
  );
}
