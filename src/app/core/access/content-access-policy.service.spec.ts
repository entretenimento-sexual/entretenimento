// src/app/core/access/content-access-policy.service.spec.ts

import { describe, expect, it } from 'vitest';

import { IUserDados } from '../interfaces/iuser-dados';
import {
  createSubscriberContentAccessPolicy,
  PUBLIC_CONTENT_ACCESS_POLICY,
} from './content-access-policy.model';
import {
  areContentAccessDecisionsEqual,
  evaluateContentAccessPolicy,
} from './content-access-policy.service';

const NOW = 2_000_000;

function createUser(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: 'https://example.com/photo.jpg',
    role: 'free',
    lastLogin: NOW,
    isSubscriber: false,
    descricao: '',
    profileCompleted: true,
    nickname: 'Pessoa',
    gender: 'outro',
    orientation: 'bissexual',
    estado: 'RJ',
    municipio: 'Rio de Janeiro',
    accountStatus: 'active',
    loginAllowed: true,
    ...overrides,
  };
}

describe('ContentAccessPolicyService', () => {
  it('bloqueia acesso anônimo e orienta login', () => {
    const decision = evaluateContentAccessPolicy(
      null,
      PUBLIC_CONTENT_ACCESS_POLICY,
      NOW
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('unauthenticated');
    expect(decision.recommendedAction).toBe('sign_in');
  });

  it('permite conteúdo público para conta ativa', () => {
    const decision = evaluateContentAccessPolicy(
      createUser(),
      PUBLIC_CONTENT_ACCESS_POLICY,
      NOW
    );

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeNull();
  });

  it('bloqueia conta suspensa antes de avaliar assinatura', () => {
    const policy = createSubscriberContentAccessPolicy('basic');
    const decision = evaluateContentAccessPolicy(
      createUser({ suspended: true }),
      policy,
      NOW
    );

    expect(decision.reason).toBe('account_restricted');
    expect(decision.recommendedAction).toBe('review_account');
  });

  it('bloqueia perfil sem consentimento adulto quando ele é obrigatório', () => {
    const policy = createSubscriberContentAccessPolicy('basic');
    const decision = evaluateContentAccessPolicy(
      createUser({
        initialAdultConsentRequired: true,
        adultConsent: null,
      }),
      policy,
      NOW
    );

    expect(decision.reason).toBe('adult_access_required');
    expect(decision.recommendedAction).toBe('confirm_adult_access');
  });

  it('bloqueia perfil marcado como menor de idade', () => {
    const policy = createSubscriberContentAccessPolicy('basic');
    const decision = evaluateContentAccessPolicy(
      createUser({ idade: 17 }),
      policy,
      NOW
    );

    expect(decision.reason).toBe('adult_access_required');
  });

  it('informa campos de perfil ausentes', () => {
    const policy = createSubscriberContentAccessPolicy('basic', [
      'photoURL',
      'municipio',
    ]);
    const decision = evaluateContentAccessPolicy(
      createUser({
        photoURL: null,
        municipio: '',
        role: 'basic',
        isSubscriber: true,
        monthlyPayer: true,
        subscriptionStatus: 'active',
        subscriptionExpires: NOW + 60_000,
      }),
      policy,
      NOW
    );

    expect(decision.reason).toBe('profile_field_missing');
    expect(decision.missingProfileFields).toEqual(['photoURL', 'municipio']);
  });

  it('orienta upgrade quando o nível do perfil é insuficiente', () => {
    const policy = createSubscriberContentAccessPolicy('premium');
    const decision = evaluateContentAccessPolicy(
      createUser({
        role: 'basic',
        isSubscriber: true,
        monthlyPayer: true,
        subscriptionStatus: 'active',
        subscriptionExpires: NOW + 60_000,
      }),
      policy,
      NOW
    );

    expect(decision.reason).toBe('role_insufficient');
    expect(decision.minimumRole).toBe('premium');
    expect(decision.recommendedAction).toBe('upgrade_subscription');
  });

  it('bloqueia assinatura expirada mesmo com role suficiente', () => {
    const policy = createSubscriberContentAccessPolicy('premium');
    const decision = evaluateContentAccessPolicy(
      createUser({
        role: 'premium',
        isSubscriber: true,
        monthlyPayer: true,
        subscriptionStatus: 'active',
        subscriptionExpires: NOW - 1,
      }),
      policy,
      NOW
    );

    expect(decision.reason).toBe('subscription_inactive');
  });

  it('permite assinatura ativa com role suficiente', () => {
    const policy = createSubscriberContentAccessPolicy('premium', [
      'nickname',
      'photoURL',
    ]);
    const decision = evaluateContentAccessPolicy(
      createUser({
        role: 'premium',
        isSubscriber: true,
        monthlyPayer: true,
        subscriptionStatus: 'active',
        subscriptionExpires: NOW + 60_000,
        initialAdultConsentRequired: true,
        adultConsent: {
          accepted: true,
          version: '1',
        },
      }),
      policy,
      NOW
    );

    expect(decision.allowed).toBe(true);
  });

  it('mantém decisões equivalentes estáveis para fluxos reativos', () => {
    const previous = evaluateContentAccessPolicy(
      createUser(),
      PUBLIC_CONTENT_ACCESS_POLICY,
      NOW
    );
    const current = evaluateContentAccessPolicy(
      createUser(),
      PUBLIC_CONTENT_ACCESS_POLICY,
      NOW
    );

    expect(areContentAccessDecisionsEqual(previous, current)).toBe(true);
  });
});
