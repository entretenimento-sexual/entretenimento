// src/app/core/services/geolocation/near-profile.service.ts
// -----------------------------------------------------------------------------
// NearbyProfilesService
// -----------------------------------------------------------------------------
//
// Serviço para buscar perfis próximos usando geohash + cálculo real de distância.
//
// Ajustes desta versão:
// - mantém a estrutura atual baseada em Promise para evitar impacto no NgRx/effects;
// - mantém @firebase/firestore porque os testes já mockam esse módulo;
// - mantém Firestore direto, sem reintroduzir FirestoreService legado;
// - centraliza validação de coordenadas em geolocation-coordinate.utils.ts;
// - evita geohashQueryBounds quando a coordenada de entrada é inválida;
// - substitui validação fraca por typeof por extractValidGeoCoordinates().
//
// Observação:
// Este service ainda pode evoluir no futuro para Observable, FirestoreContextService
// e GlobalErrorHandlerService. Não faremos isso agora para evitar refatoração ampla.

import { Injectable } from '@angular/core';

import { IUserDados } from '../../interfaces/iuser-dados';

import {
  collection,
  query,
  where,
  getDocs,
  startAt,
  limit,
} from '@firebase/firestore';

import { Firestore } from '@angular/fire/firestore';

import { geohashQueryBounds } from 'geofire-common';

import { DistanceCalculationService } from './distance-calculation.service';

import {
  extractValidGeoCoordinates,
  isValidGeoCoordinatePair,
} from './utils/geolocation-coordinate.utils';

@Injectable({ providedIn: 'root' })
export class NearbyProfilesService {
  constructor(
    private readonly db: Firestore,
    private readonly distanceCalculationService: DistanceCalculationService
  ) {}

  async getProfilesNearLocation(
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    userUid: string,
    startAfterDoc?: any
  ): Promise<IUserDados[]> {
    try {
      /**
       * Validação defensiva da coordenada de entrada.
       *
       * Mesmo que o método receba number na assinatura, em runtime ainda pode
       * chegar NaN, Infinity ou valor fora do intervalo geográfico real.
       */
      if (!isValidGeoCoordinatePair(latitude, longitude)) {
        return [];
      }

      const safeMaxDistanceKm =
        typeof maxDistanceKm === 'number' && Number.isFinite(maxDistanceKm)
          ? Math.max(1, maxDistanceKm)
          : 20;

      const safeUserUid = (userUid ?? '').trim();

      const bounds = geohashQueryBounds(
        [latitude, longitude],
        safeMaxDistanceKm * 1000
      );

      const promises = bounds.map((b) => {
        let q = query(
          collection(this.db as any, 'users'),
          where('geohash', '>=', b[0]),
          where('geohash', '<=', b[1]),
          limit(50)
        );

        /**
         * Mantém exatamente a lógica atual.
         *
         * Observação: o nome startAfterDoc sugere paginação com startAfter,
         * mas a implementação atual usa startAt. Não alteramos isso agora.
         */
        if (startAfterDoc) {
          q = query(q as any, startAt(startAfterDoc));
        }

        return getDocs(q as any);
      });

      const snapshots = await Promise.all(promises);
      const profiles: IUserDados[] = [];

      for (const snap of snapshots as any[]) {
        for (const d of snap.docs ?? []) {
          const profile = d.data() as IUserDados;

          /**
           * Filtra o próprio usuário.
           */
          if (profile.uid === safeUserUid) {
            continue;
          }

          /**
           * Validação centralizada:
           * - aceita number válido;
           * - aceita string numérica válida, se algum dado legado vier assim;
           * - rejeita NaN, Infinity, null, undefined e coordenada fora da faixa.
           */
          const profileCoords = extractValidGeoCoordinates(profile);

          if (!profileCoords) {
            continue;
          }

          const distanceInKm =
            this.distanceCalculationService.calculateDistanceInKm(
              profileCoords.latitude,
              profileCoords.longitude,
              latitude,
              longitude,
              safeMaxDistanceKm
            );

          if (distanceInKm !== null) {
            profiles.push({
              ...profile,
              latitude: profileCoords.latitude,
              longitude: profileCoords.longitude,
              distanciaKm: distanceInKm,
            });
          }
        }
      }

      return profiles;
    } catch (error) {
      /**
       * Mantém o comportamento atual de não quebrar a UX.
       *
       * Futuro:
       * - trocar console.log por GlobalErrorHandlerService com silent/skipUserNotification;
       * - considerar Observable para alinhar com o padrão mais novo do projeto.
       */
      // eslint-disable-next-line no-console
      console.log('Erro ao buscar perfis próximos:', error);

      return [];
    }
  }
}