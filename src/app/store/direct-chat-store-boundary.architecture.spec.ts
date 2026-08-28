// src/app/store/direct-chat-store-boundary.architecture.spec.ts
import { describe, expect, it } from 'vitest';

import { ROOT_EFFECTS } from './store.module';
import { STORE_FEATURE } from './reducers/feature-keys';
import { reducers } from './reducers';

describe('direct chat ownership boundary', () => {
  it('não registra uma projeção global paralela para chats diretos', () => {
    expect(Object.values(STORE_FEATURE)).not.toContain('chat');
    expect(Object.keys(reducers)).not.toContain('chat');
  });

  it('não registra ChatEffects depois da migração para facades', () => {
    expect(ROOT_EFFECTS.map((effectType) => effectType.name)).not.toContain(
      'ChatEffects'
    );
  });
});
