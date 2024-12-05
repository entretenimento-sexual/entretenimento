//src\app\core\services\general\date-time.service.ts
import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { format, differenceInMinutes, differenceInHours, differenceInDays, isBefore, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

@Injectable({
  providedIn: 'root',
})
export class DateTimeService {
  /**
   * Converte um valor genérico para `Date`, suportando `Timestamp`, Unix time, strings e objetos `Date`.
   * @param value Valor a ser convertido.
   * @returns Objeto `Date`.
   */
  convertToDate(value: any): Date {
    if (!value) throw new Error('Data inválida');
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (isNaN(date.getTime())) throw new Error('Data inválida');
      return date;
    }
    if (value.seconds && value.nanoseconds) {
      return new Date(value.seconds * 1000 + value.nanoseconds / 1000000);
    }
    throw new Error('Formato de data não suportado');
  }

  /**
   * Calcula a diferença entre duas datas em minutos.
   * @param date1 Primeira data.
   * @param date2 Segunda data.
   * @returns Diferença em minutos.
   */
  calculateDifferenceInMinutes(date1: any, date2: any): number {
    const d1 = this.convertToDate(date1);
    const d2 = this.convertToDate(date2);
    return differenceInMinutes(d1, d2);
  }

  /**
   * Calcula a diferença entre duas datas em horas.
   * @param date1 Primeira data.
   * @param date2 Segunda data.
   * @returns Diferença em horas.
   */
  calculateDifferenceInHours(date1: any, date2: any): number {
    const d1 = this.convertToDate(date1);
    const d2 = this.convertToDate(date2);
    return differenceInHours(d1, d2);
  }

  /**
   * Calcula a diferença entre duas datas em dias.
   * @param date1 Primeira data.
   * @param date2 Segunda data.
   * @returns Diferença em dias.
   */
  calculateDifferenceInDays(date1: any, date2: any): number {
    const d1 = this.convertToDate(date1);
    const d2 = this.convertToDate(date2);
    return differenceInDays(d1, d2);
  }

  /**
   * Verifica se uma data está no futuro.
   * @param date Data a ser verificada.
   * @returns Verdadeiro se a data estiver no futuro.
   */
  isFutureDate(date: any): boolean {
    const d = this.convertToDate(date);
    return isAfter(d, new Date());
  }

  /**
   * Verifica se uma data está no passado.
   * @param date Data a ser verificada.
   * @returns Verdadeiro se a data estiver no passado.
   */
  isPastDate(date: any): boolean {
    const d = this.convertToDate(date);
    return isBefore(d, new Date());
  }

  /**
   * Verifica se uma data está dentro de um intervalo.
   * @param date Data a ser verificada.
   * @param startDate Data de início.
   * @param endDate Data de término.
   * @returns Verdadeiro se a data estiver dentro do intervalo.
   */
  isWithinRange(date: any, startDate: any, endDate: any): boolean {
    const d = this.convertToDate(date);
    const start = this.convertToDate(startDate);
    const end = this.convertToDate(endDate);
    return isAfter(d, start) && isBefore(d, end);
  }

  /**
   * Formata uma data de acordo com o padrão especificado.
   * @param date Data a ser formatada.
   * @param formatType Padrão de formatação (e.g., 'dd/MM/yyyy').
   * @returns Data formatada como string.
   */
  formatDate(date: any, formatType: string): string {
    const d = this.convertToDate(date);
    return format(d, formatType, { locale: ptBR });
  }

  /**
   * Calcula tempo decorrido em formato legível (segundos, minutos, horas, dias).
   * @param date Data base.
   * @returns String legível com tempo decorrido.
   */
  calculateElapsedTime(date: any): string {
    const d = this.convertToDate(date);
    const now = new Date();
    const secondsDifference = Math.floor((now.getTime() - d.getTime()) / 1000);
    const minutesDifference = Math.floor(secondsDifference / 60);
    const hoursDifference = Math.floor(minutesDifference / 60);
    const daysDifference = Math.floor(hoursDifference / 24);

    if (secondsDifference < 60) {
      return `${secondsDifference} segundo${secondsDifference === 1 ? '' : 's'} atrás`;
    } else if (minutesDifference < 60) {
      return `${minutesDifference} minuto${minutesDifference === 1 ? '' : 's'} atrás`;
    } else if (hoursDifference < 24) {
      return `${hoursDifference} hora${hoursDifference === 1 ? '' : 's'} atrás`;
    } else {
      return `${daysDifference} dia${daysDifference === 1 ? '' : 's'} atrás`;
    }
  }
}
