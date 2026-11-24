import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDirectUnreadCutover, DIRECT_UNREAD_REQUIRED_RELEASE_GATES } from './direct-unread-cutover.policy';

describe('direct unread cutover release rehearsal', () => {
  const evidence = Object.fromEntries(DIRECT_UNREAD_REQUIRED_RELEASE_GATES.map(gate => [gate, true]));
  it('never activates the unimplemented projection even with all asserted gates', () => {
    const decision = resolveDirectUnreadCutover('PROJECTION', false, evidence);
    assert.equal(decision.activeAuthority, 'RECEIPTS');
    assert.deepEqual(decision.blockers, ['RUNTIME_NOT_IMPLEMENTED']);
  });
  it('fails closed on missing or malformed evidence', () => {
    for (const gate of DIRECT_UNREAD_REQUIRED_RELEASE_GATES) {
      const invalid = { ...evidence, [gate]: 'true' };
      const decision = resolveDirectUnreadCutover('PROJECTION', false, invalid);
      assert.equal(decision.activeAuthority, 'RECEIPTS');
      assert.ok(decision.blockers.includes(gate));
    }
    assert.ok(resolveDirectUnreadCutover('PROJECTION', false, null).blockers.length > 1);
  });
  it('emergency stop disables every experimental mode', () => {
    for (const mode of ['RECEIPTS', 'SHADOW', 'PROJECTION']) {
      for (const stop of [true, undefined, null, 'false']) {
        const decision = resolveDirectUnreadCutover(mode, stop, evidence);
        assert.equal(decision.activeAuthority, 'RECEIPTS');
        assert.equal(decision.shadowPermitted, false);
      }
    }
  });
  it('shadow never becomes the displayed authority and rollback selects receipts', () => {
    assert.deepEqual(resolveDirectUnreadCutover('SHADOW', false, null),
      { activeAuthority: 'RECEIPTS', shadowPermitted: true, blockers: [] });
    assert.deepEqual(resolveDirectUnreadCutover('RECEIPTS', false, evidence),
      { activeAuthority: 'RECEIPTS', shadowPermitted: false, blockers: [] });
    assert.equal(resolveDirectUnreadCutover('unknown', false, evidence).shadowPermitted, false);
  });
});
