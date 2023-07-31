// src\app\core\layout\layout.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MainLayoutComponent } from './main-layout/main-layout.component';
import { ErrorPageComponent } from './error-page/error-page.component';

@NgModule({
  declarations: [
    MainLayoutComponent,
    ErrorPageComponent
  ],
  imports: [
    CommonModule
  ],
  exports: [
    MainLayoutComponent,
    ErrorPageComponent
  ]
})
export class LayoutModule { }
