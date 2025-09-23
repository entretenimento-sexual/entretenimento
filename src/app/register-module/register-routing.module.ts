// src/app/register-module/register-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RegisterComponent } from './register.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';
import { authOnlyGuard } from '../core/guards/auth-only.guard';

const routes: Routes = [
  { path: '', component: RegisterComponent, data: { allowUnverified: true } },
  { path: 'welcome', component: WelcomeComponent, canActivate: [authOnlyGuard], data: { allowUnverified: true } },
  { path: 'verify', component: AuthVerificationHandlerComponent, data: { allowUnverified: true } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RegisterRoutingModule { }
