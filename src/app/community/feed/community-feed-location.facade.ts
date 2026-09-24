// src/app/community/feed/community-feed-location.facade.ts
import { Injectable, OnDestroy, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import type { CommunityFeedItem } from '../data-access/community-feed.model';

interface CommunityFeedMapCoordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly cacheKey: string;
}

const MAX_LOCATION_EMBED_URL_CACHE_ENTRIES = 64;

@Injectable()
export class CommunityFeedLocationFacade implements OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly locationEmbedUrlCache = new Map<string, SafeResourceUrl>();

  ngOnDestroy(): void {
    this.locationEmbedUrlCache.clear();
  }

  mapEmbedUrl(item: CommunityFeedItem): SafeResourceUrl | null {
    const coordinates = this.normalizedMapCoordinates(item);
    if (!coordinates) return null;

    const cached = this.locationEmbedUrlCache.get(coordinates.cacheKey);
    if (cached) return cached;

    const trusted = this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}&z=14&output=embed`
    );

    if (this.locationEmbedUrlCache.size >= MAX_LOCATION_EMBED_URL_CACHE_ENTRIES) {
      const oldestKey = this.locationEmbedUrlCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.locationEmbedUrlCache.delete(oldestKey);
    }

    this.locationEmbedUrlCache.set(coordinates.cacheKey, trusted);
    return trusted;
  }

  mapUrl(item: CommunityFeedItem): string {
    const coordinates = this.normalizedMapCoordinates(item);
    if (!coordinates) return '#';

    const query = encodeURIComponent(
      `${coordinates.latitude},${coordinates.longitude}`
    );
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  private normalizedMapCoordinates(
    item: CommunityFeedItem
  ): CommunityFeedMapCoordinates | null {
    const location = item.location;
    if (!location) return null;

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      return null;
    }

    const decimals = location.precision === 'precise' ? 6 : 2;
    const normalizedLatitudeValue = Number(latitude.toFixed(decimals));
    const normalizedLongitudeValue = Number(longitude.toFixed(decimals));
    const normalizedLatitude = Object.is(normalizedLatitudeValue, -0)
      ? 0
      : normalizedLatitudeValue;
    const normalizedLongitude = Object.is(normalizedLongitudeValue, -0)
      ? 0
      : normalizedLongitudeValue;

    return {
      latitude: normalizedLatitude,
      longitude: normalizedLongitude,
      cacheKey:
        `${location.precision}:${normalizedLatitude.toFixed(decimals)},${normalizedLongitude.toFixed(decimals)}`,
    };
  }
}
