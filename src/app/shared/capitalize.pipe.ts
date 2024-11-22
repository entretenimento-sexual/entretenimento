// src/app/shared/capitalize.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'capitalize',
    standalone: false
})
export class CapitalizePipe implements PipeTransform {
  transform(value: string | undefined): string {
    if (!value) {
      return '';
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
