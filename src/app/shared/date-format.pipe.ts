// src/app/shared/date-format.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';
import { format, isValid, differenceInHours, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';

@Pipe({
    name: 'dateFormat',
    standalone: false
})
export class DateFormatPipe implements PipeTransform {
  transform(value: any, formatType: string = 'datetime'): string {
    if (!value) return 'Data inválida';

    let date: Date;

    // Converte Firebase Timestamp para Date
    if (value instanceof Timestamp) {
      date = value.toDate();
    } else if (value instanceof Date) {
      date = value;
    } else {
      return 'Data inválida';
    }

    if (!isValid(date)) return 'Data inválida';

    // Processa o tipo de exibição com base no parâmetro formatType
    switch (formatType) {
      case 'date':
        return format(date, 'dd/MM/yyyy', { locale: ptBR });
      case 'time':
        return format(date, 'HH:mm', { locale: ptBR });
      case 'elapsed': {
        const now = new Date();
        const hoursDifference = differenceInHours(now, date);
        const daysDifference = differenceInDays(now, date);

        if (hoursDifference < 24) {
          return `${hoursDifference} hora${hoursDifference === 1 ? '' : 's'} atrás`;
        } else {
          return `${daysDifference} dia${daysDifference === 1 ? '' : 's'} atrás`;
        }
      }
      case 'datetime':
      default:
        return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
    }
  }
}
