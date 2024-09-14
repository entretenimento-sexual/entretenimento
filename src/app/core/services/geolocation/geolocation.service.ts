// src\app\core\services\geolocation.service.ts
import { Injectable } from '@angular/core';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';
import { geohashForLocation } from 'geofire-common';

@Injectable({
  providedIn: 'root'
})

export class GeolocationService {


  getCurrentLocation(): Promise<GeoCoordinates> {
    return new Promise((resolve, reject) => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const geohash = geohashForLocation([position.coords.latitude, position.coords.longitude]);
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              altitude: position.coords.altitude,
              accuracy: position.coords.accuracy,
              altitudeAccuracy: position.coords.altitudeAccuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
              geohash: geohash
            });
          },
          (error) => {
            switch (error.code) {
              case error.PERMISSION_DENIED:
                reject(new Error('Permissão de localização negada.'));
                break;
              case error.POSITION_UNAVAILABLE:
                reject(new Error('Posição não disponível.'));
                break;
              case error.TIMEOUT:
                reject(new Error('O tempo de solicitação de localização expirou.'));
                break;
              default:
                reject(new Error('Erro desconhecido ao tentar obter localização.'));
            }
          }
        );
      } else {
        reject(new Error('Geolocalização não suportada pelo navegador.'));
      }
    });
  }
}

