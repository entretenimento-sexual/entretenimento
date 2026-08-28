// src/app/dashboard/online/online-users/utils/online-users-debug.utils.ts
// -----------------------------------------------------------------------------
// OnlineUsersDebugUtils
// -----------------------------------------------------------------------------
//
// Funções auxiliares de debug da listagem online/próximos.
//
// Esta extração é propositalmente segura:
// - não altera regra de negócio;
// - não altera geolocalização;
// - não altera NgRx;
// - não altera template;
// - apenas tira console.table estruturado do componente.
//
// Motivo:
// O OnlineUsersComponent deve deixar de carregar responsabilidade de debug
// detalhado. O debug continua existindo, mas isolado em util próprio.

import type {
  IUserWithDistance,
  NormalizedCandidate,
} from '../models/online-users.model';

export function debugOnlineCandidatesTable(
  normalized: NormalizedCandidate[],
  accepted: IUserWithDistance[],
  enabled: boolean
): void {
  if (!enabled) return;

  const candidateRows = normalized.map((item) => ({
    uid: item.debug.uid,
    nickname: item.debug.nickname,

    latitude: item.debug.latitude,
    longitude: item.debug.longitude,
    latitudeType: item.debug.latitudeType,
    longitudeType: item.debug.longitudeType,

    normalizedLatitude: item.debug.normalizedLatitude,
    normalizedLongitude: item.debug.normalizedLongitude,

    distanciaKm: item.debug.distanciaKm,
    capKm: item.debug.capKm,
    withinRadius: item.debug.withinRadius,

    hasUid: item.debug.hasUid,
    isSelf: item.debug.isSelf,
    hasCoords: item.debug.hasCoords,

    rejectionReasons: item.debug.rejectionReasons.join(', '),

    isOnline: item.debug.isOnline,
    presenceState: item.debug.presenceState,

    role: item.debug.role,
    municipio: item.debug.municipio,
    estado: item.debug.estado,
    gender: item.debug.gender,
  }));

  const acceptedRows = accepted.map((user) => ({
    uid: user.uid,
    nickname: user.nickname,
    distanciaKm: user.distanciaKm,
    latitude: user.latitude,
    longitude: user.longitude,
  }));

  // eslint-disable-next-line no-console
  console.table(candidateRows);

  // eslint-disable-next-line no-console
  console.table(acceptedRows);
}