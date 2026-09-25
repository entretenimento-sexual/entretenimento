import { describe, expect, it } from 'vitest';

import { normalizeCommunityAdminTimelinePage } from './community-admin-timeline.model';

describe('normalizeCommunityAdminTimelinePage', () => {
  it('normaliza apenas o contrato consumível', () => {
    const page = normalizeCommunityAdminTimelinePage({
      items: [{
        id: 'event-1',
        category: 'membership',
        eventType: 'member_role_changed',
        actor: { kind: 'user', label: 'ANA' },
        subject: { kind: 'user', label: 'BIA' },
        details: { previousRole: 'member', nextRole: 'moderator' },
        createdAt: 1000,
        actorUid: 'nao-deve-ser-consumido',
      }],
      nextCursor: null,
      generatedAt: 1100,
    });

    expect(page?.items[0]).toEqual({
      id: 'event-1',
      category: 'membership',
      eventType: 'member_role_changed',
      actor: { kind: 'user', label: 'ANA' },
      subject: { kind: 'user', label: 'BIA' },
      details: { previousRole: 'member', nextRole: 'moderator' },
      createdAt: 1000,
    });
  });

  it('falha fechado para evento desconhecido', () => {
    expect(normalizeCommunityAdminTimelinePage({
      items: [{
        id: 'event-1',
        category: 'membership',
        eventType: 'raw_audit_dump',
        actor: { kind: 'system', label: 'Sistema' },
        subject: null,
        details: {},
        createdAt: 1000,
      }],
      nextCursor: null,
      generatedAt: 1100,
    })).toBeNull();
  });
});
