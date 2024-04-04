import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatModuleLayoutComponent } from './chat-module-layout.component';

describe('ChatModuleLayoutComponent', () => {
  let component: ChatModuleLayoutComponent;
  let fixture: ComponentFixture<ChatModuleLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatModuleLayoutComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ChatModuleLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
