// src/app/store/room-store-boundary.architecture.spec.ts
import { describe, expect, it } from 'vitest';

import { CHAT_FEATURE_EFFECTS } from './effects/effects.chat/chat-feature.effects';
import { ChatEffects } from './effects/effects.chat/chat.effects';
import { STORE_FEATURE } from './reducers/feature-keys';
import { reducers } from './reducers';

describe('room store ownership boundary', () => {
  it('não registra uma segunda slice global para salas', () => {
    expect(Object.values(STORE_FEATURE)).not.toContain('room');
    expect(Object.keys(reducers)).not.toContain('room');
  });

  it('não registra orquestração NgRx paralela para salas', () => {
    expect(CHAT_FEATURE_EFFECTS).toEqual([ChatEffects]);
    expect(
      CHAT_FEATURE_EFFECTS.map((effectType) => effectType.name)
    ).not.toContain('RoomEffects');
  });
});
