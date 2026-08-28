// src/test/setup-vitest.ts
/// <reference types="vitest/globals" />

// ============================================================================
// SETUP GLOBAL DE TESTES — VITEST + ANGULAR
// ----------------------------------------------------------------------------
// Este arquivo deve preparar apenas o ambiente JS/browser dos testes.
//
// Não configure TestBed aqui.
// Motivo:
// - o Angular CLI já inicializa o ambiente Angular;
// - muitos specs configuram o próprio TestBed;
// - configurar providers globais aqui causa conflitos como:
//   "Cannot configure the test module when the test module has already been instantiated".
// ============================================================================

import 'cross-fetch/polyfill';
import 'fake-indexeddb/auto';

import { afterEach, vi } from 'vitest';

// ============================================================================
// TextEncoder / TextDecoder
// ----------------------------------------------------------------------------
// Não importamos `node:util`, para evitar ruído do TypeScript/editor.
// Node moderno normalmente já expõe essas APIs em globalThis.
// Estes fallbacks são mínimos e suficientes para specs.
// ============================================================================

class MinimalTextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const normalized = String(input);
    const encoded = unescape(encodeURIComponent(normalized));

    return new Uint8Array(
      Array.from(encoded).map((char) => char.charCodeAt(0))
    );
  }

  encodeInto(input: string, destination: Uint8Array): {
    read: number;
    written: number;
  } {
    const encoded = this.encode(input);
    const written = Math.min(encoded.length, destination.length);

    destination.set(encoded.slice(0, written));

    return {
      read: String(input ?? '').length,
      written,
    };
  }
}

class MinimalTextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal = false;
  readonly ignoreBOM = false;

  decode(input?: ArrayBuffer | ArrayBufferView | null): string {
    if (!input) {
      return '';
    }

    const bytes =
      input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);

    const binary = Array.from(bytes)
      .map((byte) => String.fromCharCode(byte))
      .join('');

    try {
      return decodeURIComponent(escape(binary));
    } catch {
      return binary;
    }
  }
}

if (!(globalThis as any).TextEncoder) {
  (globalThis as any).TextEncoder = MinimalTextEncoder;
}

if (!(globalThis as any).TextDecoder) {
  (globalThis as any).TextDecoder = MinimalTextDecoder;
}

// ============================================================================
// Canvas mock
// ============================================================================

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

// ============================================================================
// Browser observers
// ============================================================================

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

(globalThis as any).ResizeObserver = ResizeObserverMock;
(globalThis as any).IntersectionObserver = IntersectionObserverMock;

// ============================================================================
// matchMedia
// ============================================================================

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// ============================================================================
// Scroll / animation frame
// ============================================================================

if (typeof window !== 'undefined' && !window.scrollTo) {
  Object.defineProperty(window, 'scrollTo', {
    value: vi.fn(),
    writable: true,
  });
}

if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
    writable: true,
  });
}

if (typeof window !== 'undefined' && !window.cancelAnimationFrame) {
  Object.defineProperty(window, 'cancelAnimationFrame', {
    value: (id: number) => clearTimeout(id),
    writable: true,
  });
}

// ============================================================================
// Object URLs
// ============================================================================

if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:vitest-object-url'),
    writable: true,
  });
}

if (typeof URL !== 'undefined' && !URL.revokeObjectURL) {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    writable: true,
  });
}

// ============================================================================
// Limpeza básica entre specs
// ============================================================================

afterEach(() => {
  vi.clearAllMocks();
});