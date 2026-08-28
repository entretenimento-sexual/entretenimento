import { describe, expect, it } from 'vitest';

import { normalizeCommunityTopicModerationResponse } from './community-topic.model';

describe('normalizeCommunityTopicModerationResponse', () => {
  it('normaliza resposta válida de lock sem confiar em campos extras', () => {
    const generatedAt = Date.now();
    const result = normalizeCommunityTopicModerationResponse({
      communityId: 'community-1',
      topicId: 'topic-1',
      action: 'lock',
      status: 'locked',
      moderationState: 'active',
      deduplicated: false,
      generatedAt,
      actorUid: 'nao-deve-vazar',
    });

    expect(result).toEqual({
      communityId: 'community-1',
      topicId: 'topic-1',
      action: 'lock',
      status: 'locked',
      moderationState: 'active',
      deduplicated: false,
      generatedAt,
    });
    expect('actorUid' in result).toBe(false);
  });

  it('aceita archived/removed somente como resultado de moderação', () => {
    const result = normalizeCommunityTopicModerationResponse({
      communityId: 'community-1',
      topicId: 'topic-1',
      action: 'remove',
      status: 'archived',
      moderationState: 'removed',
      deduplicated: true,
      generatedAt: Date.now(),
    });

    expect(result.status).toBe('archived');
    expect(result.moderationState).toBe('removed');
    expect(result.deduplicated).toBe(true);
  });

  it('rejeita resposta inconsistente da callable', () => {
    expect(() =>
      normalizeCommunityTopicModerationResponse({
        communityId: '../community',
        topicId: 'topic-1',
        action: 'delete',
        status: 'active',
        moderationState: 'active',
        generatedAt: Date.now(),
      })
    ).toThrow('Resposta de moderação de Tópico inválida.');
  });
});
