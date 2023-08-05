// src\app\user-profile\user-details\user-details.component.ts
import { Component, OnInit } from '@angular/core';
import { UserProfileService } from '../services-profile/user-profile.service';

@Component({
  selector: 'app-user-details',
  templateUrl: './user-details.component.html',
  styleUrls: ['./user-details.component.css']
})
export class UserDetailsComponent implements OnInit {
  userProfile: any;

  constructor(private userProfileService: UserProfileService) { }

  ngOnInit(): void {
    // Aqui, certifique-se de passar o ID correto do usuário, caso contrário, você pode testar com um ID fixo
    this.userProfileService.getUserProfile('OkummhvQT8RBkNMBZTcY').subscribe(profile => {
      this.userProfile = profile;
    });
  }
}
