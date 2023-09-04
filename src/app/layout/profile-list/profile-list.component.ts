// src/app/layout/profile-list/profile-list.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-profile-list',
  templateUrl: './profile-list.component.html',
  styleUrls: ['./profile-list.component.css']
})
export class ProfileListComponent implements OnInit {
  user: any;

  constructor(private authService: AuthService) { }

  ngOnInit(): void {
    this.user = this.authService.currentUser;
  }
}
