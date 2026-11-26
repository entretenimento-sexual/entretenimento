import { describe, expect, it, vi } from 'vitest';
import { createChatMessageSnapshotProjector } from './chat-message-snapshot-projection';

const snapshot = (fromCache: boolean, hasPendingWrites: boolean, changed: boolean, status = 'sent') => ({
  metadata: { fromCache, hasPendingWrites },
  docs: [{ id: 'm1', data: vi.fn(() => ({ id: 'wrong', status })) }],
  docChanges: () => changed ? [{}] : [],
});

describe('createChatMessageSnapshotProjector', () => {
  it('suppresses duplicate metadata-only snapshots without reading message contents again', () => {
    const project = createChatMessageSnapshotProjector();
    expect(project(snapshot(false, false, false))).toEqual([{ id: 'm1', status: 'sent' }]);
    const duplicate = snapshot(false, false, false);
    expect(project(duplicate)).toBeNull();
    expect(duplicate.docs[0].data).not.toHaveBeenCalled();
  });

  it('preserves document changes and pending receipt transitions and confirmations', () => {
    const project = createChatMessageSnapshotProjector();
    project(snapshot(false, false, true));
    expect(project(snapshot(false, true, true, 'delivered'))).toEqual([{ id: 'm1', status: 'delivered' }]);
    expect(project(snapshot(false, true, true, 'read'))).toEqual([{ id: 'm1', status: 'read' }]);
    expect(project(snapshot(false, false, false, 'read'))).toEqual([{ id: 'm1', status: 'read' }]);
    expect(project(snapshot(false, false, false, 'read'))).toBeNull();
  });

  it('clears data on cache-only snapshots and republishes the first server confirmation', () => {
    const project = createChatMessageSnapshotProjector();
    const cached = snapshot(true, false, true);
    expect(project(cached)).toEqual([]);
    expect(cached.docs[0].data).not.toHaveBeenCalled();
    expect(project(snapshot(true, false, true))).toBeNull();
    expect(project(snapshot(false, false, false))).toEqual([{ id: 'm1', status: 'sent' }]);
    expect(project(snapshot(true, false, false))).toEqual([]);
    expect(project(snapshot(false, false, false))).toEqual([{ id: 'm1', status: 'sent' }]);
    expect(createChatMessageSnapshotProjector()(snapshot(false, false, false))).toEqual([{ id: 'm1', status: 'sent' }]);
  });

  it('publishes removals and confirmed empty windows', () => {
    const project = createChatMessageSnapshotProjector();
    const empty = { metadata: { fromCache: false, hasPendingWrites: false }, docs: [], docChanges: () => [] };
    expect(project(empty)).toEqual([]);
    project(snapshot(false, false, true));
    expect(project({ ...empty, docChanges: () => [{}] })).toEqual([]);
  });
});
