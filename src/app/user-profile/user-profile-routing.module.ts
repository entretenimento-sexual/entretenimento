// src\app\user-profile\user-profile-routing.module.ts
// Módulo de roteamento para o perfil do usuário.
// Buscar padronização em uid ao invés de id, se possível.
// Não esqueça os comentários explicativos.
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';

import { UserOwnerGuard } from '../core/guards/ownership-guard/user.owner.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';

const routes: Routes = [
  // ✅ /perfil  → abre o próprio perfil (sem :id)
  // Importante: isso elimina a rota inválida e usa seu fallback atual no componente.
  { path: '', component: UserProfileViewComponent, pathMatch: 'full' },

  // ✅ /perfil/:uid → qualquer perfil (inclusive outros)
  { path: ':uid', component: UserProfileViewComponent },

  // ✅ editar: primeiro checa dono (segurança), depois checa verificação (feature gate)
  {
    path: ':id/editar-dados-pessoais',
    component: EditUserProfileComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard]
  },

  {
    path: ':id/edit-profile-preferences',
    component: EditProfilePreferencesComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard]
  },

  {
    path: ':id/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    // canActivate: [UserOwnerGuard, emailVerifiedGuard]
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserProfileRoutingModule { }

/*
Estados do usuário e acesso às rotas em relação a perfil e verificação de e-mail.
GUEST: não autenticado
AUTHED + PROFILE_INCOMPLETE: logado, mas ainda não completou cadastro mínimo
AUTHED + PROFILE_COMPLETE + UNVERIFIED: logado, cadastro ok, mas e-mail não verificado
AUTHED + PROFILE_COMPLETE + VERIFIED: liberado total
*/
