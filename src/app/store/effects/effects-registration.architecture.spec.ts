import { describe, expect, it } from 'vitest';

import { LAYOUT_FEATURE_EFFECTS } from '../../layout/layout-feature.effects';
import { ROOT_EFFECTS } from '../store.module';
import { CHAT_FEATURE_EFFECTS } from './effects.chat/chat-feature.effects';
import { ChatEffects } from './effects.chat/chat.effects';
import { InviteEffects } from './effects.chat/invite.effects';
import { RoomEffects } from './effects.chat/room.effects';
import { NearbyProfilesEffects } from './effects.location/nearby-profiles.effects';


describe('NgRx effect registration boundaries', () => {
  it('mantém apenas owners globais necessários no root', () => {
    expect(ROOT_EFFECTS).toContain(InviteEffects);
    expect(ROOT_EFFECTS).not.toContain(ChatEffects);
    expect(ROOT_EFFECTS).not.toContain(RoomEffects);
    expect(ROOT_EFFECTS).not.toContain(NearbyProfilesEffects);
  });

  it('carrega conversa e salas somente com a feature lazy de chat', () => {
    expect(CHAT_FEATURE_EFFECTS).toEqual([ChatEffects, RoomEffects]);
    expect(CHAT_FEATURE_EFFECTS).not.toContain(InviteEffects);
  });

  it('carrega perfis próximos somente com o LayoutModule lazy', () => {
    expect(LAYOUT_FEATURE_EFFECTS).toEqual([NearbyProfilesEffects]);
  });
});
