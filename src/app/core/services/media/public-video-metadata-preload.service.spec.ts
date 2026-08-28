import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER,
  PublicVideoMetadataPreloadService,
  canPreloadPublicVideoMetadata,
} from './public-video-metadata-preload.service';

class FakeVideoElement {
  preload = '';
  muted = false;
  playsInline = false;
  src = '';

  readonly load = vi.fn();
  readonly pause = vi.fn();
  readonly removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });

  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type) ?? new Set<EventListener>();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const VIDEO = {
  id: 'video_1',
  ownerUid: 'owner_1',
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  posterAccess: 'NONE',
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  url: 'https://example.test/video.mp4?token=temporary',
  accessExpiresAt: Date.now() + 300_000,
} as IPublicVideoItem;

describe('canPreloadPublicVideoMetadata', () => {
  it('permite rede normal com documento visível', () => {
    expect(canPreloadPublicVideoMetadata({
      documentVisible: true,
      online: true,
      saveData: false,
      effectiveType: '4g',
      downlinkMbps: 10,
    })).toBe(true);
  });

  it.each([
    ['economia de dados', { saveData: true }],
    ['2G', { effectiveType: '2g' }],
    ['banda medida insuficiente', { downlinkMbps: 0.8 }],
    ['offline', { online: false }],
    ['aba oculta', { documentVisible: false }],
  ])('bloqueia %s', (_label, override) => {
    expect(canPreloadPublicVideoMetadata({
      documentVisible: true,
      online: true,
      saveData: false,
      effectiveType: '4g',
      downlinkMbps: 10,
      ...override,
    })).toBe(false);
  });

  it('mantém compatibilidade quando o navegador não informa a banda', () => {
    expect(canPreloadPublicVideoMetadata({
      documentVisible: true,
      online: true,
      saveData: false,
      effectiveType: null,
      downlinkMbps: null,
    })).toBe(true);
  });
});

describe('PublicVideoMetadataPreloadService', () => {
  let fakeVideo: FakeVideoElement;
  let createElement: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeVideo = new FakeVideoElement();
    createElement = vi.fn(() => fakeVideo as unknown as HTMLVideoElement);

    TestBed.configureTestingModule({
      providers: [
        PublicVideoMetadataPreloadService,
        {
          provide: DOCUMENT,
          useValue: { createElement },
        },
        {
          provide: PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER,
          useValue: () => ({
            documentVisible: true,
            online: true,
            saveData: false,
            effectiveType: '4g',
            downlinkMbps: 10,
          }),
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });
  });

  it('prepara metadados uma vez e limpa o elemento ao concluir', () => {
    const service = TestBed.inject(PublicVideoMetadataPreloadService);

    expect(service.preloadMetadata(VIDEO)).toBe(true);
    expect(service.preloadMetadata(VIDEO)).toBe(false);
    expect(createElement).toHaveBeenCalledTimes(1);
    expect(fakeVideo.preload).toBe('metadata');
    expect(fakeVideo.muted).toBe(true);
    expect(fakeVideo.playsInline).toBe(true);
    expect(fakeVideo.src).toBe(VIDEO.url);

    fakeVideo.emit('loadedmetadata');

    expect(fakeVideo.pause).toHaveBeenCalledTimes(1);
    expect(fakeVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(fakeVideo.src).toBe('');
    expect(fakeVideo.load).toHaveBeenCalledTimes(2);
  });

  it('cancela preload ativo sem remover a deduplicação da URL', () => {
    const service = TestBed.inject(PublicVideoMetadataPreloadService);

    expect(service.preloadMetadata(VIDEO)).toBe(true);
    service.cancelMetadataPreload(VIDEO);

    expect(fakeVideo.pause).toHaveBeenCalledTimes(1);
    expect(fakeVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(service.preloadMetadata(VIDEO)).toBe(false);
  });

  it('não cria elemento quando a política de rede bloqueia', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        PublicVideoMetadataPreloadService,
        {
          provide: DOCUMENT,
          useValue: { createElement },
        },
        {
          provide: PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER,
          useValue: () => ({
            documentVisible: true,
            online: true,
            saveData: true,
            effectiveType: '4g',
            downlinkMbps: 10,
          }),
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    const service = TestBed.inject(PublicVideoMetadataPreloadService);

    expect(service.preloadMetadata(VIDEO)).toBe(false);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('não prepara acesso vencido ou próximo de expirar', () => {
    const service = TestBed.inject(PublicVideoMetadataPreloadService);
    const expiring = {
      ...VIDEO,
      accessExpiresAt: Date.now() + 5_000,
    } as IPublicVideoItem;

    expect(service.preloadMetadata(expiring)).toBe(false);
    expect(createElement).not.toHaveBeenCalled();
  });
});
