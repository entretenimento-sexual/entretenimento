import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_DISTRIBUTION_TELEMETRY_BATCH_SIZE,
  normalizeCommunityDistributionTelemetryRequest,
} from './community-distribution-telemetry.policy';

test('normaliza e deduplica eventos por Comunidade, superfície e tipo', () => {
  assert.deepEqual(
    normalizeCommunityDistributionTelemetryRequest({
      events: [
        {
          communityId: 'community-1',
          surface: 'social_explore_recommendation',
          eventType: 'qualified_exposure',
        },
        {
          communityId: 'community-1',
          surface: 'social_explore_recommendation',
          eventType: 'qualified_exposure',
        },
        {
          communityId: 'community-1',
          surface: 'social_explore_recommendation',
          eventType: 'open',
        },
      ],
    }),
    {
      events: [
        {
          communityId: 'community-1',
          surface: 'social_explore_recommendation',
          eventType: 'qualified_exposure',
        },
        {
          communityId: 'community-1',
          surface: 'social_explore_recommendation',
          eventType: 'open',
        },
      ],
    }
  );
});

test('rejeita campos livres, ids inseguros e lote acima do limite', () => {
  for (const events of [
    [],
    [{
      communityId: '../community',
      surface: 'social_explore_content',
      eventType: 'open',
    }],
    [{
      communityId: 'community-1',
      surface: 'arbitrary_surface',
      eventType: 'open',
    }],
    [{
      communityId: 'community-1',
      surface: 'social_explore_content',
      eventType: 'click_anything',
    }],
    Array.from(
      { length: COMMUNITY_DISTRIBUTION_TELEMETRY_BATCH_SIZE + 1 },
      (_, index) => ({
        communityId: `community-${index}`,
        surface: 'social_explore_activity',
        eventType: 'qualified_exposure',
      })
    ),
  ]) {
    assert.equal(
      normalizeCommunityDistributionTelemetryRequest({ events }),
      null
    );
  }
});
