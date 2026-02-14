// src\app\shared\pipes\date-format.pipe.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
// Pipe para formatação de datas usando DateTimeService.
// - Suporta formatos: 'date' (dd/MM/yyyy), 'time' (HH:mm), 'datetime' (dd/MM/yyyy HH:mm), 'elapsed' (tempo decorrido).
// - Retorna mensagem customizável para datas inválidas.
// - Usa DateTimeService para conversão e formatação, garantindo consistência em toda a aplicação.
// - Exemplo de uso: {{ user.createdAt | dateFormat:'date' }} para exibir apenas a data de criação do usuário.
import { Pipe, PipeTransform } from '@angular/core';
import { DateTimeService } from '../../core/services/general/date-time.service';

@Pipe({
  name: 'dateFormat',
  standalone: true
})
export class DateFormatPipe implements PipeTransform {
  constructor(private dateTimeService: DateTimeService) { }

  transform(value: any, formatType: string = 'datetime', invalidMessage: string = 'Data inválida'): string {
    if (value === null || value === undefined || value === '') return '';

    try {
      const date = this.dateTimeService.convertToDate(value);
      switch (formatType) {
        case 'date': return this.dateTimeService.formatDate(date, 'dd/MM/yyyy');
        case 'time': return this.dateTimeService.formatDate(date, 'HH:mm');
        case 'elapsed': return this.dateTimeService.calculateElapsedTime(date);
        default: return this.dateTimeService.formatDate(date, 'dd/MM/yyyy HH:mm');
      }
    } catch {
      return invalidMessage;
    }
  }
}
