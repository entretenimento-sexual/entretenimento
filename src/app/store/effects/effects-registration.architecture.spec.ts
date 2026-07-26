import { describe, expect, it } from 'vitest';

import { ROOT_EFFECTS } from '../store.module';
import { CHAT_FEATURE_EFFECTS } from './effects.chat/chat-feature.effects';
import { ChatEffects } from './effects.chat/chat.effects';
import { InviteEffects } from './effects.chat/invite.effects';
import { RoomEffects } from './effects.chat/room.effects';

describe('NgRx effect registration boundaries', () => {
  it('mantém apenas o owner global de convites no root', () => {
    expect(ROOT_EFFECTS).toContain(InviteEffects);
    expect(ROOT_EFFECTS).not.toContain(ChatEffects);
    expect(ROOT_EFFECTS).not.toContain(RoomEffects);
  });

  it('carrega conversa e salas somente com a feature lazy de chat', () => {
    expect(CHAT_FEATURE_EFFECTS).toEqual([ChatEffects, RoomEffects]);
    expect(CHAT_FEATURE_EFFECTS).not.toContain(InviteEffects);
  });
});
