import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Community notification summary scale boundary', () => {
  it('mantém o hot path em um documento global e proíbe listener da coleção inteira', () => {
    const service = source(
      'src/app/core/services/notifications/community-notification-unread-summary.service.ts'
    );

    expect(service).toContain("'community_notification_summaries',");
    expect(service).toContain('uid\n      );');
    expect(service).not.toContain('collectionData(');
    expect(service).not.toContain('watchUserSummaries$(');
    expect(service).toContain('attentionWindow');
  });

  it('carrega detalhe de unread somente para os cards já paginados de Minhas', () => {
    const handler = source(
      'functions/src/community/get-my-communities-page.handler.ts'
    );

    const pageResult = handler.indexOf(
      'const result = await collectCommunityMyPageIncrementally'
    );
    const detailRead = handler.indexOf(
      'const summarySnapshots = result.items.length > 0'
    );

    expect(pageResult).toBeGreaterThanOrEqual(0);
    expect(detailRead).toBeGreaterThan(pageResult);
    expect(handler).toContain('result.items.map((item)');
    expect(handler).toContain("'community_notification_summaries'");
  });

  it('reconciliação de saída não varre estados de notificação do usuário inteiro', () => {
    const trigger = source(
      'functions/src/community/reconcile-community-membership-notifications.trigger.ts'
    );

    expect(trigger).toContain(".where('userId', '==', uid)");
    expect(trigger).toContain(".where('communityId', '==', communityId)");
  });

  it('writers canônicos atualizam o agregado global na mesma transação', () => {
    const notificationTrigger = source(
      'functions/src/community/sync-community-notification-summary.trigger.ts'
    );
    const membershipTrigger = source(
      'functions/src/community/reconcile-community-membership-notifications.trigger.ts'
    );

    expect(notificationTrigger).toContain(
      'prepareCommunityNotificationGlobalSummaryWrite'
    );
    expect(membershipTrigger).toContain(
      'prepareCommunityNotificationGlobalSummaryWrite'
    );
  });
});
