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
            reject(error);
          }
        );
      } else {
        reject(new Error('Geolocalização não suportada pelo navegador.'));
      }
    });
  }
}

