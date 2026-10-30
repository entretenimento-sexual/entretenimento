import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  discoveryReadRateLimitCost,
  serializePublicProfileForDiscovery,
  attachViewerCompatibilityToPublicCards,
  filterDiscoveryCardsByOwnerLifecycle,
  filterDiscoveryCardsByViewerBlocks,
  selectVisibleDiscoveryBatch,
} from './get-public-profiles-page.handler';

const NOW = 1_800_000_000_000;

function profile(overrides: Record<string, unknown> = {}) {
  return {
    nickname: 'Perfil público',
    updatedAt: {
      toMillis: () => NOW - 1_000,
    },
    ...overrides,
  };
}

describe('get-public-profiles-page boundary', () => {
  it('serializa perfil público sem depender de assurance etário', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-1',
      profile({
        age: 41,
        ageEligibilityVerifiedAdult: false,
        ageEligibilityValidUntil: null,
      }),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['uid'], 'profile-1');
    assert.equal(serialized['age'], 41);
    assert.equal('ageEligibilityVerifiedAdult' in serialized, false);
    assert.equal('ageEligibilityValidUntil' in serialized, false);
  });

  it('entrega somente a apresentação pública e ignora descrição privada residual', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-about',
      profile({
        descricao: 'Texto privado',
        publicDescription: 'Apresentação autorizada',
      }),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['publicDescription'], 'Apresentação autorizada');
    assert.equal('descricao' in serialized, false);
    assert.deepEqual(serialized['publicSeekingGenders'], null);
  });

  it('não entrega interesses privados ou aliases legados no JSON público', () => {
    const serialized = serializePublicProfileForDiscovery('secret-target', profile({
      preferences: ['segredo'],
      interestedInGenders: ['man'],
      generosDeInteresse: ['woman'],
      interestedInOrientations: ['homosexual'],
      publicSeekingGenders: ['women'],
    }), NOW);
    assert.ok(serialized);
    for (const privateField of [
      'preferences', 'interestedInGenders', 'generosDeInteresse',
      'interestedInOrientations',
    ]) {
      assert.equal(Object.hasOwn(serialized, privateField), false, privateField);
    }
    assert.deepEqual(serialized['publicSeekingGenders'], ['women']);
  });

  it('calcula reciprocidade usando documento privado sem revelar preferências do alvo', () => {
    const viewer = {
      normalizedGender: 'man',
      normalizedOrientation: 'heterosexual',
      interestedInGenders: ['woman'],
      interestedInOrientations: ['heterosexual'],
      discoveryPreferences: { genderInterests: ['women'] },
      email: 'private-viewer@example.test',
    };
    const privateOwner = {
      normalizedGender: 'woman',
      normalizedOrientation: 'heterosexual',
      interestedInGenders: ['man'],
      interestedInOrientations: ['heterosexual'],
      discoveryPreferences: { genderInterests: ['men'] },
      email: 'private-owner@example.test',
    };
    const publicCard = serializePublicProfileForDiscovery(
      'owner', profile({ gender: 'woman', publicSeekingGenders: [] }), NOW
    );
    assert.ok(publicCard);
    const owners = new Map<string, Record<string, unknown> | null>([
      ['owner', privateOwner],
    ]);
    const [visible] = attachViewerCompatibilityToPublicCards(
      [publicCard], 'viewer', viewer, owners
    );

    assert.equal(visible['viewerCompatibilityAllowed'], true);
    assert.equal(visible['viewerCompatibilityReason'], 'compatible');
    for (const field of [
      'interestedInGenders', 'interestedInOrientations',
      'discoveryPreferences', 'email',
    ]) {
      assert.equal(Object.hasOwn(visible, field), false, field);
    }

    owners.set('owner', {
      ...privateOwner,
      interestedInGenders: ['woman'], // Proprietária não procura homens.
    });
    const [denied] = attachViewerCompatibilityToPublicCards(
      [publicCard], 'viewer', viewer, owners
    );
    assert.equal(denied['viewerCompatibilityAllowed'], false);
    assert.equal(denied['viewerCompatibilityReason'], 'incompatible');
    // A projeção pública representa listas vazias como null; a recusa de
    // compatibilidade não pode expor as escolhas privadas da proprietária.
    assert.equal(denied['publicSeekingGenders'], null);
    assert.equal(Object.hasOwn(denied, 'interestedInGenders'), false);
  });

  it('filtra bloqueios bilaterais inclusive em leituras por UID', () => {
    const cards = [
      { uid: 'active', nickname: 'Ativo' },
      { uid: 'blocked-by-viewer', nickname: 'Bloqueado' },
      { uid: 'blocked-by-owner', nickname: 'Bloqueou o visitante' },
    ];
    assert.deepEqual(filterDiscoveryCardsByViewerBlocks(
      cards,
      new Set(['blocked-by-viewer', 'blocked-by-owner'])
    ), [{ uid: 'active', nickname: 'Ativo' }]);
  });

  it('descarta idade social fora da faixa sem bloquear o perfil', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-invalid-social-age',
      profile({ age: 17 }),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['age'], null);
  });

  it('exige apenas identidade pública mínima para serialização', () => {
    assert.equal(
      serializePublicProfileForDiscovery('', profile(), NOW),
      null
    );
    assert.equal(
      serializePublicProfileForDiscovery(
        'profile-no-nickname',
        profile({ nickname: '' }),
        NOW
      ),
      null
    );
  });

  it('descarta projeção pública residual após restrição da conta dona', () => {
    const cards = [
      { uid: 'active', nickname: 'Ativa' },
      { uid: 'age-review', nickname: 'Sob revisão' },
      { uid: 'minor-confirmed', nickname: 'Suspensa' },
      { uid: 'locked', nickname: 'Bloqueada' },
      { uid: 'missing', nickname: 'Sem conta' },
    ];
    const owners = new Map<string, Record<string, unknown> | null>([
      ['active', { accountStatus: 'active', publicVisibility: 'visible' }],
      ['age-review', {
        accountStatus: 'active', publicVisibility: 'hidden',
        interactionBlocked: true,
      }],
      ['minor-confirmed', {
        accountStatus: 'moderation_suspended', suspended: true,
        publicVisibility: 'hidden',
      }],
      ['locked', {
        accountStatus: 'active', accountLocked: true,
      }],
      ['missing', null],
    ]);
    assert.deepEqual(
      filterDiscoveryCardsByOwnerLifecycle(cards, owners),
      [{ uid: 'active', nickname: 'Ativa' }]
    );
  });

  it('repõe perfis válidos e mantém cursor sem perder candidatos pré-carregados', () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      card: { uid: `owner-${index + 1}` },
      position: { uid: `owner-${index + 1}`, updatedAtMs: NOW - index },
    }));
    const visibleUids = new Set(['owner-3', 'owner-5', 'owner-7', 'owner-8']);
    const first = selectVisibleDiscoveryBatch(candidates, visibleUids, 2);
    assert.deepEqual(first.items.map((item) => item['uid']), ['owner-3', 'owner-5']);
    assert.deepEqual(first.filledAt, candidates[4].position);
    const remaining = candidates.slice(5);
    const next = selectVisibleDiscoveryBatch(remaining, visibleUids, 2);
    assert.deepEqual(next.items.map((item) => item['uid']), ['owner-7', 'owner-8']);
    assert.deepEqual(next.filledAt, candidates[7].position);
    const partial = selectVisibleDiscoveryBatch(candidates, new Set(['owner-8']), 2);
    assert.equal(partial.filledAt, null);
    assert.deepEqual(partial.items.map((item) => item['uid']), ['owner-8']);
  });

  it('dimensiona a quota de leitura proporcionalmente ao custo da consulta', () => {
    assert.equal(discoveryReadRateLimitCost({ pageSize: 24 }), 1);
    assert.equal(discoveryReadRateLimitCost({ pageSize: 48 }), 2);
    assert.equal(discoveryReadRateLimitCost({ pageSize: 120 }), 5);
    assert.equal(discoveryReadRateLimitCost({ uidCount: 25 }), 1);
    assert.equal(discoveryReadRateLimitCost({ uidCount: 50 }), 2);
    assert.equal(discoveryReadRateLimitCost({}), 1);
  });
});
