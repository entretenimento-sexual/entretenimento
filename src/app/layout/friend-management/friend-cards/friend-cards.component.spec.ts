import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FriendCardsComponent } from './friend-cards.component';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

@Component({selector:'app-user-card', standalone:true, template:'{{ user().uid }}'})
class UserCardStub {
  readonly user = input.required<{uid:string}>();
  readonly distanciaKm = input<number|null>(null);
}

describe('FriendCardsComponent pagination continuity',()=>{
  let fixture: ComponentFixture<FriendCardsComponent>;
  const items = [{uid:'a',nickname:'A'},{uid:'b',nickname:'B'}];
  const cards = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.friend-cards-item'));
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  beforeEach(async()=>{
    await TestBed.configureTestingModule({
      imports:[FriendCardsComponent],
      providers:[{provide:PrivacyDebugLoggerService,useValue:{log:()=>{}}}]
    }).overrideComponent(FriendCardsComponent,{
      remove:{imports:[UserCardComponent]},add:{imports:[UserCardStub]}
    }).compileComponents();
    fixture=TestBed.createComponent(FriendCardsComponent);
  });
  it('preserves existing card nodes throughout append and tail invalidation',async()=>{
    fixture.componentRef.setInput('items',items);
    await render();
    const before=cards();
    expect(before.length).toBe(2);
    fixture.componentRef.setInput('isLoading',true);
    await render();
    expect(cards()[0]).toBe(before[0]);
    expect(cards()[1]).toBe(before[1]);
    fixture.componentRef.setInput('items',[...items,{uid:'c',nickname:'C'}]);
    fixture.componentRef.setInput('isLoading',false);
    await render();
    expect(cards().length).toBe(3);
    expect(cards()[0]).toBe(before[0]);
    expect(cards()[1]).toBe(before[1]);
    fixture.componentRef.setInput('items',items);
    await render();
    expect(cards().length).toBe(2);
    expect(cards()[0]).toBe(before[0]);
    expect(cards()[1]).toBe(before[1]);
  });
  it('does not retain cards when the input is cleared during loading',async()=>{
    fixture.componentRef.setInput('items',items);
    await render();
    expect(cards().length).toBe(2);
    fixture.componentRef.setInput('items',[]);
    fixture.componentRef.setInput('isLoading',true);
    await render();
    expect(cards().length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Carregando amigos');
  });
});
