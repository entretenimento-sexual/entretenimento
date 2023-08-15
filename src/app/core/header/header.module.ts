// src\app\core\header\header.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogoComponent } from './logo/logo.component';
import { NavbarComponent } from './navbar/navbar.component';
import { SearchComponent } from './search/search.component';
import { UserIconComponent } from './user-icon/user-icon.component';
import { HeaderComponent } from './header/header.component';
import { RouterModule } from '@angular/router';

@NgModule({
  declarations: [
    LogoComponent,
    NavbarComponent,
    SearchComponent,
    UserIconComponent,
    HeaderComponent
  ],
  imports: [
    CommonModule,
    RouterModule
  ],
  exports: [
    LogoComponent,
    NavbarComponent,
    SearchComponent,
    UserIconComponent,
    HeaderComponent
  ]
})
export class HeaderModule { }
