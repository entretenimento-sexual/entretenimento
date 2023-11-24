//src\app\shared\shared\shared.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DateFormatPipe } from './date-format.pipe';
import { CapitalizePipe } from './capitalize.pipe';


@NgModule({
  declarations: [DateFormatPipe, CapitalizePipe],
  imports: [
    CommonModule
  ],
  exports: [DateFormatPipe, CapitalizePipe]
})
export class SharedModule { }
