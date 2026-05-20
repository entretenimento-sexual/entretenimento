// src/app/dashboard/online/online-users/models/online-users.model.ts
// -----------------------------------------------------------------------------
// OnlineUsersModel
// -----------------------------------------------------------------------------
//
// Tipos específicos da listagem de usuários online/próximos.
//
// Esta extração é propositalmente leve:
// - não altera comportamento;
// - não mexe em geolocalização;
// - não mexe em NgRx;
// - não cria service novo;
// - apenas remove tipos do componente para começar a esvaziá-lo com segurança.
//
// Motivo:
// O OnlineUsersComponent já acumula muitas responsabilidades. A primeira etapa
// segura é retirar dele os modelos auxiliares, preservando os mesmos nomes para
// evitar refatoração ampla agora.

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export type UserLocation = {
  latitude: number;
  longitude: number;
};

export type IUserWithDistance = IUserDados & {
  distanciaKm?: number;
};

export type NormalizedCandidate = {
  original: IUserDados;

  normalized: IUserWithDistance;

  debug: {
    uid: string | null;
    nickname: string | null;

    latitude: unknown;
    longitude: unknown;

    latitudeType: string;
    longitudeType: string;

    normalizedLatitude: number | null;
    normalizedLongitude: number | null;

    distanciaKm: number | null;
    capKm: number;
    withinRadius: boolean;

    hasUid: boolean;
    isSelf: boolean;
    hasCoords: boolean;

    rejectionReasons: string[];

    isOnline: unknown;
    lastSeen: unknown;
    presenceState: unknown;

    role: unknown;
    municipio: unknown;
    estado: unknown;
    gender: unknown;
  };
};