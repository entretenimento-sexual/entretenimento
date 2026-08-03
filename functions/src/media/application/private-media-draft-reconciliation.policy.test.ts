import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcilePrivateMediaDraftUsage } from './private-media-draft-reconciliation.policy';

test('soma rascunhos ativos e reservas de upload ainda ativas', () => {
  const result = reconcilePrivateMediaDraftUsage(
    {},
    [
      {
        kind: 'photo',
        draftReservationActive: true,
        draftReservedBytes: 100,
      },
      {
        kind: 'video',
        draftReservationActive: true,
        draftReservedBytes: 800,
      },
      {
        kind: 'photo',
        draftReservationActive: false,
        draftReservedBytes: 999,
      },
    ],
    [
      {
        kind: 'photo',
        state: 'ACTIVE',
        reservedItemCount: 1,
        reservedUsageBytes: 50,
      },
      {
        kind: 'video',
        state: 'CONSUMED',
        reservedItemCount: 1,
        reservedUsageBytes: 900,
      },
      {
        kind: 'photo',
        state: 'ACTIVE',
        reservedItemCount: 0,
        reservedUsageBytes: 20,
      },
    ]
  );

  assert.deepEqual(result.expected, {
    photoCount: 2,
    photoReservedBytes: 170,
    videoCount: 1,
    videoReservedBytes: 800,
  });
  assert.equal(result.activeDrafts.photos, 1);
  assert.equal(result.activeDrafts.videos, 1);
  assert.equal(result.activeUploadReservations, 2);
});

test('informa delta positivo e negativo sem normalizá-lo para zero', () => {
  const result = reconcilePrivateMediaDraftUsage(
    {
      photoCount: 4,
      photoReservedBytes: 500,
      videoCount: 0,
      videoReservedBytes: 0,
    },
    [
      {
        kind: 'photo',
        draftReservationActive: true,
        draftReservedBytes: 100,
      },
      {
        kind: 'video',
        draftReservationActive: true,
        draftReservedBytes: 600,
      },
    ],
    []
  );

  assert.deepEqual(result.delta, {
    photoCount: -3,
    photoReservedBytes: -400,
    videoCount: 1,
    videoReservedBytes: 600,
  });
  assert.equal(result.consistent, false);
});

test('considera consistente quando a projeção corresponde às fontes', () => {
  const result = reconcilePrivateMediaDraftUsage(
    {
      photoCount: 1,
      photoReservedBytes: 100,
      videoCount: 0,
      videoReservedBytes: 0,
    },
    [
      {
        kind: 'photo',
        draftReservationActive: true,
        draftReservedBytes: 100,
      },
    ],
    []
  );

  assert.equal(result.consistent, true);
});
