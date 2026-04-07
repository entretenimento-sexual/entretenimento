//src\test\setup-vitest.ts
/// <reference types="vitest/globals" />

import 'cross-fetch/polyfill';
import 'fake-indexeddb/auto';

import { TextEncoder, TextDecoder } from 'node:util';
import { beforeEach, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { commonTestingProviders } from './jest-stubs/test-providers';

if (!(globalThis as any).TextEncoder) {
  (globalThis as any).TextEncoder = TextEncoder;
}

if (!(globalThis as any).TextDecoder) {
  (globalThis as any).TextDecoder = TextDecoder as any;
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    canvas: {},
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
  }),
  configurable: true,
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

(globalThis as any).ResizeObserver = ResizeObserverMock;

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [RouterTestingModule, HttpClientTestingModule],
    providers: [
      provideMockStore({
        initialState: {
          user: {
            currentUser: null,
            isAuthenticated: false,
            usuarios: [],
            onlineUsers: [],
            filteredOnlineUsers: [],
          },
          chat: {
            chats: [],
            messages: [],
            loading: false,
            error: null,
          },
          friendship: {
            requests: [],
            friends: [],
            incoming: [],
            sent: [],
            loading: false,
            error: null,
          },
        },
      }),
      ...commonTestingProviders(),
      { provide: MAT_DIALOG_DATA, useValue: {} },
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      {
        provide: MatSnackBar,
        useValue: {
          open: vi.fn(() => ({
            onAction: () => of(void 0),
            afterDismissed: () => of({ dismissedByAction: false }),
          })),
        },
      },
    ],
  });
});