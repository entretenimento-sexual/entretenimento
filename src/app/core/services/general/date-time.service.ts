// src/app/core/services/general/date-time.service.ts
import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import {
  format,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  isWithinInterval,
  formatDistanceToNowStrict,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

type TimestampLike = { seconds: number; nanoseconds?: number };
type DateLike = Date | Timestamp | number | string | TimestampLike;

@Injectable({ providedIn: 'root' })
export class DateTimeService {
  /** Tenta converter um valor genérico para Date. Lança erro se inválido. */
  convertToDate(value: DateLike): Date {
    if (value == null) throw new Error('Data inválida');

    // Date
    if (value instanceof Date) return value;

    // Firestore Timestamp
    if (value instanceof Timestamp) return value.toDate();

    // Objeto tipo {seconds, nanoseconds}
    if (typeof value === 'object') {
      const v = value as TimestampLike;
      if (typeof v.seconds === 'number') {
        const ms = v.seconds * 1000 + (v.nanoseconds ? v.nanoseconds / 1_000_000 : 0);
        const d = new Date(ms);
        if (Number.isFinite(d.getTime())) return d;
      }
      throw new Error('Formato de data não suportado');
    }

    // number ou string
    if (typeof value === 'number') {
      const d = new Date(value);
      if (Number.isFinite(d.getTime())) return d;
      throw new Error('Data inválida');
    }

    // string: tratar numeric-like como epoch
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        const asNumber = Number(trimmed);
        const d = new Date(asNumber);
        if (Number.isFinite(d.getTime())) return d;
      }
      // tenta parse “normal” (ISO, etc.)
      const d = new Date(trimmed);
      if (Number.isFinite(d.getTime())) return d;
      throw new Error('Data inválida');
    }

    throw new Error('Formato de data não suportado');
  }

  /** Diferença em minutos. Por padrão, absoluta. */
  calculateDifferenceInMinutes(date1: DateLike, date2: DateLike, absolute = true): number {
    const d1 = this.convertToDate(date1);
    const d2 = this.convertToDate(date2);
    const diff = differenceInMinutes(d1, d2);
    return absolute ? Math.abs(diff) : diff;
  }

  /** Diferença em horas. Por padrão, absoluta. */
  calculateDifferenceInHours(date1: DateLike, date2: DateLike, absolute = true): number {
    const d1 = this.convertToDate(date1);
    const d2 = this.convertToDate(date2);
    const diff = differenceInHours(d1, d2);
    return absolute ? Math.abs(diff) : diff;
  }

  /** Diferença em dias. Por padrão, absoluta. */
  calculateDifferenceInDays(date1: DateLike, date2: DateLike, absolute = true): number {
    const d1 = this.convertToDate(date1);
    const d2 = this.convertToDate(date2);
    const diff = differenceInDays(d1, d2);
    return absolute ? Math.abs(diff) : diff;
  }

  /** Está no futuro? */
  isFutureDate(date: DateLike): boolean {
    const d = this.convertToDate(date);
    return d.getTime() > Date.now();
  }

  /** Está no passado? */
  isPastDate(date: DateLike): boolean {
    const d = this.convertToDate(date);
    return d.getTime() < Date.now();
  }

  /** Intervalo (inclusivo nas bordas). */
  isWithinRange(date: DateLike, startDate: DateLike, endDate: DateLike): boolean {
    const d = this.convertToDate(date);
    const start = this.convertToDate(startDate);
    const end = this.convertToDate(endDate);
    const a = Math.min(start.getTime(), end.getTime());
    const b = Math.max(start.getTime(), end.getTime());
    return isWithinInterval(d, { start: new Date(a), end: new Date(b) });
  }

  /** Formata uma data (padrão: 'dd/MM/yyyy HH:mm'). */
  formatDate(date: DateLike, formatType = 'dd/MM/yyyy HH:mm'): string {
    const d = this.convertToDate(date);
    return format(d, formatType, { locale: ptBR });
  }

  /** “há x tempo” com pluralização correta. */
  calculateElapsedTime(date: DateLike): string {
    const d = this.convertToDate(date);
    return formatDistanceToNowStrict(d, { addSuffix: true, locale: ptBR });
  }

  /** Converte para epoch ms (number). Retorna null se inválido. */
  toEpoch(value: DateLike): number | null {
    try { return this.convertToDate(value).getTime(); } catch { return null; }
  }

  /** Converte para Firestore Timestamp. Retorna null se inválido. */
  toTimestamp(value: DateLike): Timestamp | null {
    try { return Timestamp.fromDate(this.convertToDate(value)); } catch { return null; }
  }

  nowEpoch(): number { return Date.now(); }
}
