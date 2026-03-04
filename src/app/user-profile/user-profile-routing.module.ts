// src/app/user-profile/user-profile-routing.module.ts
// Módulo de roteamento para o perfil do usuário.
// ✅ Padronização: usamos :uid como canônico.
// ✅ Compatibilidade: mantemos rotas antigas com :id apontando para o MESMO componente.
// (Evita redirectTo com parâmetro — que é fácil de errar e costuma gerar debug ruim.)

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';

import { UserOwnerGuard } from '../core/guards/ownership-guard/user.owner.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';

const routes: Routes = [
  // ✅ /perfil  → abre o próprio perfil
  { path: '', component: UserProfileViewComponent, pathMatch: 'full' },

  // ✅ /perfil/:uid → qualquer perfil
  { path: ':uid', component: UserProfileViewComponent },

  // ===========================================================================
  // ✅ ROTAS CANÔNICAS (NOVAS) — param padronizado: :uid
  // ===========================================================================
  {
    path: ':uid/editar-dados-pessoais',
    component: EditUserProfileComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard],
  },
  {
    path: ':uid/edit-profile-preferences',
    component: EditProfilePreferencesComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard],
  },
  {
    path: ':uid/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard],
  },

  // ===========================================================================
  // ✅ COMPAT (LEGADO) — mantém links antigos funcionando
  // - Evita redirectTo com params.
  // - Quando quiser “apertar” o sistema, dá pra remover depois.
  // ===========================================================================
  {
    path: ':id/editar-dados-pessoais',
    component: EditUserProfileComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard],
  },
  {
    path: ':id/edit-profile-preferences',
    component: EditProfilePreferencesComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard],
  },
  {
    path: ':id/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserProfileRoutingModule { }
