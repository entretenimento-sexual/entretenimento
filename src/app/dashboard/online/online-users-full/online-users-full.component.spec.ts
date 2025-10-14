// src/app/dashboard/online-users-full/online-users-full.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';

import { OnlineUsersFullComponent } from './online-users-full.component';

describe('OnlineUsersFullComponent', () => {
  let component: OnlineUsersFullComponent;
  let fixture: ComponentFixture<OnlineUsersFullComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnlineUsersFullComponent],
      providers: [
        provideRouter([]),
        provideStore({}) // injeta store “vazio” só para criar o componente
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(OnlineUsersFullComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
