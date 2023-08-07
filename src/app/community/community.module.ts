// src\app\community\community.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CreateCommunityComponent } from './create-community/create-community.component';
import { ViewCommunityComponent } from './view-community/view-community.component';
import { CommunityComponent } from './community/community.component';

import { CommunityService } from '../core/services/community/community.service';



@NgModule({
  declarations: [
    CreateCommunityComponent,
    ViewCommunityComponent,
    CommunityComponent
  ],

  imports: [
    CommonModule
  ],

  providers: [CommunityService]
})

export class CommunityModule { }
