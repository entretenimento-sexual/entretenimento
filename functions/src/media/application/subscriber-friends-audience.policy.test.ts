import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canCreateFriendsOnlyPublication, canIssueFriendsMediaAccess,
} from './subscriber-friends-audience.policy';

const now = 1_800_000_000_000;
const subscriber = {
  role: 'basic', billingProjectionVersion: 1, isSubscriber: true,
  subscriptionStatus: 'active', subscriptionScope: 'platform_subscription',
  subscriptionStartedAt: now - 1000, subscriptionEndsAt: now + 10_000,
};

describe('new restricted media audience entitlement', () => {
  it('mantém PUBLIC disponível sem revelar conteúdo existente', () => {
    assert.equal(canCreateFriendsOnlyPublication(null, 'PUBLIC', now), true);
    assert.equal(canCreateFriendsOnlyPublication({}, 'PUBLIC', now), true);
  });
  it('bloqueia FRIENDS para contas gratuitas e sem projeção válida', () => {
    assert.equal(canCreateFriendsOnlyPublication(null, 'FRIENDS', now), false);
    assert.equal(canCreateFriendsOnlyPublication({ role: 'free' }, 'FRIENDS', now), false);
    assert.equal(canCreateFriendsOnlyPublication({
      ...subscriber, isSubscriber: false
    }, 'FRIENDS', now), false);
    assert.equal(canCreateFriendsOnlyPublication({
      ...subscriber, billingProjectionVersion: 0
    }, 'FRIENDS', now), false);
    assert.equal(canCreateFriendsOnlyPublication({
      ...subscriber, role: 'admin', isSubscriber: false
    }, 'FRIENDS', now), false);
    assert.equal(canCreateFriendsOnlyPublication({
      ...subscriber, role: 'admin'
    }, 'FRIENDS', now), false);
  });
  it('permite FRIENDS com assinatura Basic vigente e nega após expiração', () => {
    assert.equal(canCreateFriendsOnlyPublication(subscriber, 'FRIENDS', now), true);
    assert.equal(canCreateFriendsOnlyPublication(
      subscriber, 'FRIENDS', now + 10_001
    ), false);
  });
  it('nega URL FRIENDS de terceiros sem entitlement do titular', () => {
    assert.equal(canIssueFriendsMediaAccess({
      viewerIsOwner: false, viewerIsFriend: true,
      ownerHasFriendsEntitlement: false,
    }), false);
    assert.equal(canIssueFriendsMediaAccess({
      viewerIsOwner: false, viewerIsFriend: true,
      ownerHasFriendsEntitlement: true,
    }), true);
    assert.equal(canIssueFriendsMediaAccess({
      viewerIsOwner: false, viewerIsFriend: false,
      ownerHasFriendsEntitlement: true,
    }), false);
    assert.equal(canIssueFriendsMediaAccess({
      viewerIsOwner: true, viewerIsFriend: false,
      ownerHasFriendsEntitlement: false,
    }), true);
  });
  it('recusa audiências desconhecidas', () => {
    assert.equal(canCreateFriendsOnlyPublication(subscriber, 'PRIVATE', now), false);
    assert.equal(canCreateFriendsOnlyPublication(subscriber, 'SUBSCRIBERS', now), false);
  });
});
