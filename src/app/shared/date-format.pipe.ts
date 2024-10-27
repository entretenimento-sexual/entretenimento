//src\app\shared\date-format.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';
import { format, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';

@Pipe({
  name: 'dateFormat'
})
export class DateFormatPipe implements PipeTransform {
  transform(value: any, dateFormat: string = 'dd/MM/yyyy HH:mm'): string {
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

    if (isValid(date)) {
      return format(date, dateFormat, { locale: ptBR });
    } else {
      return 'Data inválida';
    }
  }
}
