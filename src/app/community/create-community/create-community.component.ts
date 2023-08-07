// src\app\community\create-community\create-community.component.ts
import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { CommunityService } from 'src/app/core/services/community/community.service';

@Component({
  selector: 'app-create-community',
  templateUrl: './create-community.component.html',
  styleUrls: ['./create-community.component.css']
})
export class CreateCommunityComponent {

  constructor(private authService: AuthService, private communityService: CommunityService) { }

  async createCommunity(data: any) {
    if (await this.authService.hasExtaseProfile()) {
      this.communityService.createCommunity(data);
    } else {
      alert('Somente usuários extase podem criar comunidades.');
    }
  }

}
