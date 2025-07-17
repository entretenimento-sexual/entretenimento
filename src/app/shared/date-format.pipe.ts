// src/app/shared/date-format.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';
import { DateTimeService } from '../core/services/general/date-time.service';

@Pipe({
  name: 'dateFormat',
  standalone: false
})
export class DateFormatPipe implements PipeTransform {
  constructor(private dateTimeService: DateTimeService) { }

  transform(value: any, formatType: string = 'datetime', invalidMessage: string = 'Data inválida'): string {
    try {
      const date = this.dateTimeService.convertToDate(value); // Usa o serviço para conversão

      // Processa o tipo de exibição com base no parâmetro formatType
      switch (formatType) {
        case 'date':
          return this.dateTimeService.formatDate(date, 'dd/MM/yyyy');
        case 'time':
          return this.dateTimeService.formatDate(date, 'HH:mm');
        case 'elapsed':
          return this.dateTimeService.calculateElapsedTime(date); // Usa o serviço para tempo decorrido
        case 'datetime':
        default:
          return this.dateTimeService.formatDate(date, 'dd/MM/yyyy HH:mm');
      }
    } catch (error) {
      console.log('Erro ao formatar a data:', error);
      return invalidMessage;
    }
  }
}
