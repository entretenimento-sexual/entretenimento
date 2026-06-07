// src/app/core/services/privacy/privacy-debug-logger.service.ts
// -----------------------------------------------------------------------------
// PRIVACY DEBUG LOGGER
// -----------------------------------------------------------------------------
// Logger centralizado para debug seguro.
//
// Objetivos:
// - evitar console.log espalhado com dados sensíveis;
// - padronizar máscara de UID, e-mail, chatId e URLs;
// - manter debug opt-in por canal;
// - impedir logs sensíveis por padrão em dev/staging/prod;
// - reduzir duplicação em services grandes.
//
// Uso:
// this.privacyDebug.log('access-control', 'canRunApp$', { uid, url });
//
// Para ativar um canal temporariamente no navegador:
// localStorage.setItem('DEBUG_ACCESS_CONTROL', '1');
// localStorage.setItem('DEBUG_AUTH_ORCHESTRATOR', '1');
// localStorage.setItem('DEBUG_ROUTER', '1');
// localStorage.setItem('DEBUG_PRESENCE', '1');
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';

export type PrivacyDebugChannel =
  | 'cache'
  | 'auth'
  | 'presence'
  | 'router'
  | 'access-control'
  | 'auth-orchestrator'
  | 'online-users'
  | 'friends'
  | 'chat'
  | 'layout'
  | 'profile'
  | 'storage'
  | 'generic';

type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error';

const CHANNEL_FLAGS: Record<PrivacyDebugChannel, string> = {
  cache: 'DEBUG_CACHE',
  auth: 'DEBUG_AUTH',
  presence: 'DEBUG_PRESENCE',
  router: 'DEBUG_ROUTER',
  'access-control': 'DEBUG_ACCESS_CONTROL',
  'auth-orchestrator': 'DEBUG_AUTH_ORCHESTRATOR',
  'online-users': 'DEBUG_ONLINE_USERS',
  friends: 'DEBUG_FRIENDS',
  chat: 'DEBUG_CHAT',
  layout: 'DEBUG_LAYOUT',
  profile: 'DEBUG_PROFILE',
  storage: 'DEBUG_STORAGE',
  generic: 'DEBUG_GENERIC',
};

const CHANNEL_PREFIXES: Record<PrivacyDebugChannel, string> = {
  cache: 'Cache',
  auth: 'Auth',
  presence: 'Presence',
  router: 'Router',
  'access-control': 'AccessControl',
  'auth-orchestrator': 'AuthOrchestrator',
  'online-users': 'OnlineUsers',
  friends: 'Friends',
  chat: 'Chat',
  layout: 'Layout',
  profile: 'Profile',
  storage: 'Storage',
  generic: 'Debug',
};

@Injectable({ providedIn: 'root' })
export class PrivacyDebugLoggerService {
  private readonly privacyLogging = environment.privacyLogging;

  canLog(channel: PrivacyDebugChannel): boolean {
  return this.canLogChannel(channel);
}

  log(
    channel: PrivacyDebugChannel,
    message: string,
    extra?: unknown,
    level: ConsoleLevel = 'info'
  ): void {
    if (!this.canLogChannel(channel)) {
      return;
    }

const prefix = `[${CHANNEL_PREFIXES[channel]}]`;

/**
 * A mensagem é controlada pelo código-fonte, não pelo usuário.
 *
 * Não sanitizamos o texto fixo do log para evitar falsos positivos como:
 * - "AuthSessionService" virar "Auth...vice";
 * - "PresenceOrchestrator" virar "Pres...ator".
 *
 * Dados sensíveis devem ir no `extra`, que continua sanitizado.
 */
const safeExtra = this.sanitize(extra);

// eslint-disable-next-line no-console
console[level](prefix, message, safeExtra ?? '');
  }

  sanitize(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.maskSensitiveString(value.message),
      };
    }

    if (typeof value === 'string') {
      return this.maskSensitiveString(value);
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(record)) {
      sanitized[key] = this.sanitizeField(key, item);
    }

    return sanitized;
  }

  maskUid(value: unknown): string | null {
    const uid = String(value ?? '').trim();

    if (!uid) {
      return null;
    }

    if (this.canLogSensitiveConsoleData()) {
      return uid;
    }

    if (uid.length <= 8) {
      return 'masked';
    }

    return `${uid.slice(0, 4)}...${uid.slice(-4)}`;
  }

  maskSensitiveString(value: unknown): string {
    const text = String(value ?? '');

    if (!text) {
      return text;
    }

    return text
      .split(/([:/?&=|,\s]+)/)
      .map((token) => this.maskToken(token))
      .join('');
  }

  private sanitizeField(key: string, value: unknown): unknown {
    const normalizedKey = key.trim().toLowerCase();

    if (
      normalizedKey === 'uid' ||
      normalizedKey.endsWith('uid') ||
      normalizedKey === 'userid' ||
      normalizedKey === 'user_id'
    ) {
      return this.maskUid(value);
    }

    if (
      normalizedKey === 'email' ||
      normalizedKey === 'mail' ||
      normalizedKey.endsWith('email')
    ) {
      return this.maskEmail(value);
    }

if (
  normalizedKey === 'url' ||
  normalizedKey === 'downloadurl' ||
  normalizedKey === 'currenturl' ||
  normalizedKey === 'navpath' ||
  normalizedKey === 'path' ||
  normalizedKey === 'route' ||
  normalizedKey.endsWith('path') ||
  normalizedKey.endsWith('url')
) {
  return this.maskSensitiveString(value);
}

    if (
      normalizedKey === 'chatid' ||
      normalizedKey === 'selectedchatid' ||
      normalizedKey === 'directchatid'
    ) {
      return this.maskSensitiveString(value);
    }

    /**
     * Campos que podem revelar localização, perfil ou preferências.
     * Para debug comum, basta saber se existem.
     */
    if (
      normalizedKey === 'gender' ||
      normalizedKey === 'genero' ||
      normalizedKey === 'sexo' ||
      normalizedKey === 'estado' ||
      normalizedKey === 'municipio' ||
      normalizedKey === 'cidade' ||
      normalizedKey === 'city' ||
      normalizedKey === 'state' ||
      normalizedKey === 'nickname'
    ) {
      return value ? 'present' : null;
    }

    return this.sanitize(value);
  }

  private canLogChannel(channel: PrivacyDebugChannel): boolean {
    if (environment.production) {
      return false;
    }

    if (this.privacyLogging?.enabled !== true) {
      return false;
    }

    try {
      return localStorage.getItem(CHANNEL_FLAGS[channel]) === '1';
    } catch {
      return false;
    }
  }

  private canLogSensitiveConsoleData(): boolean {
    if (environment.production) {
      return false;
    }

    if (this.privacyLogging?.allowSensitiveConsoleData !== true) {
      return false;
    }

    try {
      return localStorage.getItem('ALLOW_SENSITIVE_CONSOLE_DATA') === '1';
    } catch {
      return false;
    }
  }

  private maskToken(token: string): string {
    const cleanToken = String(token ?? '').trim();

    if (!cleanToken) {
      return token;
    }

    if (this.looksLikeEmail(cleanToken)) {
      return this.maskEmail(cleanToken) ?? 'masked-email';
    }

    if (this.looksLikeDirectChatId(cleanToken)) {
      return this.maskDirectChatId(cleanToken);
    }

    if (this.looksLikeFirebaseUid(cleanToken)) {
      return this.maskUid(cleanToken) ?? 'masked';
    }

    return token;
  }

  private looksLikeFirebaseUid(value: string): boolean {
    return /^[A-Za-z0-9_-]{18,80}$/.test(value);
  }

  private looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private looksLikeDirectChatId(value: string): boolean {
    return /^direct_[a-f0-9]{32,128}$/i.test(value);
  }

  private maskEmail(value: unknown): string | null {
    const email = String(value ?? '').trim();

    if (!email) {
      return null;
    }

    if (this.canLogSensitiveConsoleData()) {
      return email;
    }

    const [name, domain] = email.split('@');

    if (!name || !domain) {
      return 'masked-email';
    }

    return `${name.slice(0, 1)}***@${domain}`;
  }

  private maskDirectChatId(value: string): string {
    if (this.canLogSensitiveConsoleData()) {
      return value;
    }

    return `${value.slice(0, 13)}...${value.slice(-6)}`;
  }
}