//src\app\shared\date-format.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';
import { format, isValid, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

@Pipe({
  name: 'dateFormat'
})
export class DateFormatPipe implements PipeTransform {
  transform(value: any, dateFormat: string = 'dd/MM/yyyy'): string {
    if (!value) return '';

    let date = value;
    if (typeof value === 'string') {
      date = parseISO(value);
    }

    if (isValid(date)) {
      return format(date, dateFormat, { locale: ptBR });
    } else {
      return 'Data inválida';
    }
  }
}
