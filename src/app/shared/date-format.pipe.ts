//src\app\shared\date-format.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

@Pipe({
  name: 'dateFormat'
})
export class DateFormatPipe implements PipeTransform {

  transform(value: any, ...args: any[]): any {
    return format(new Date(value), 'dd/MM/yyyy', { locale: ptBR });
  }

}


