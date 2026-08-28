import { describe, expect, it } from 'vitest';

import {
  SOCIAL_SPACE_DEFINITIONS,
  getSocialSpaceDefinition,
} from './social-space.definition';

describe('social space definitions', () => {
  it('mantém Local, Comunidade e Sala como conceitos distintos', () => {
    expect(SOCIAL_SPACE_DEFINITIONS.venue.description).toContain('Lugar físico');
    expect(SOCIAL_SPACE_DEFINITIONS.community.description).toContain(
      'Grupo permanente'
    );
    expect(SOCIAL_SPACE_DEFINITIONS.room.description).toContain(
      'Espaço de conversa'
    );
  });

  it('mantém rotas canônicas separadas', () => {
    expect(getSocialSpaceDefinition('venue').navigationRoute).toBe(
      '/dashboard/locais'
    );
    expect(getSocialSpaceDefinition('community').navigationRoute).toBe(
      '/dashboard/comunidades'
    );
    expect(getSocialSpaceDefinition('room').navigationRoute).toBe('/chat/rooms');
  });
});
