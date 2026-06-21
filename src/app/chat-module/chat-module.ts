//src\app\chat-module\chat-module.ts
import { NgModule } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { StoreModule } from '@ngrx/store';
import { ChatModuleRoutingModule } from './chat-module-routing.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SharedModule } from '../shared/shared.module';

import { ChatListComponent } from './chat-list/chat-list.component';
import { ChatWindowComponent } from './chat-window/chat-window.component';
import { ChatMessageComponent } from './chat-message/chat-message.component';
import { ChatModuleLayoutComponent } from './chat-module-layout/chat-module-layout.component';
import { ChatMessagesListComponent } from './chat-messages-list/chat-messages-list.component';
import { ChatRoomsComponent } from './chat-rooms/chat-rooms.component';
import { RoomCreationConfirmationModalComponent } from './modals/room-create-confirm-modal/room-creation-confirmation-modal.component';
import { InviteListComponent } from './invite-list/invite-list.component';
import { chatReducer } from '../store/reducers/reducers.chat/chat.reducer';
import { RoomInteractionComponent } from './rooms/room-interaction/room-interaction.component';

import { RoomsModule } from './rooms/rooms.module';
import { CommunitiesModule } from './communities/communities.module';
import { CreateRoomModalComponent } from './modals/create-room-modal/create-room-modal.component';
import { BaseModalComponent } from './modals/base-modal/base-modal.component';
import { TimeAgoPipe } from 'src/app/shared/pipes/time-ago.pipe';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { ChatDraftDirective } from './directives/chat-draft.directive';
import { ChatEmojiComposerDirective } from './directives/chat-emoji-composer.directive';
import { ActiveChatNotificationDirective } from './directives/active-chat-notification.directive';
import { ChatEmojiPickerComponent } from './chat-emoji-picker/chat-emoji-picker.component';
import { ChatComposerAutosizeDirective } from './directives/chat-composer-autosize.directive';
import { CopyMessageTextDirective } from './directives/copy-message-text.directive';
import { ReplyToMessageDirective } from './directives/reply-to-message.directive';
import { CloseDetailsOnOutsideDirective } from './directives/close-details-on-outside.directive';
import { DeleteDirectMessageDirective } from './directives/delete-direct-message.directive';
import { ChatReplyQuotePipe } from './pipes/chat-reply-quote.pipe';

@NgModule({
  declarations: [
    ChatListComponent,
    ChatWindowComponent,
    ChatMessageComponent,
    ChatModuleLayoutComponent,
    ChatRoomsComponent,
    ChatMessagesListComponent,
    CreateRoomModalComponent,
    InviteListComponent,
    RoomCreationConfirmationModalComponent,
    RoomInteractionComponent,
    ChatDraftDirective,
    ChatEmojiComposerDirective,
    ActiveChatNotificationDirective,
    ChatEmojiPickerComponent,
    ChatComposerAutosizeDirective,
    CopyMessageTextDirective,
    ReplyToMessageDirective,
    CloseDetailsOnOutsideDirective,
    DeleteDirectMessageDirective,
    ChatReplyQuotePipe,
  ],
  imports: [
    CommonModule,
    StoreModule.forFeature('chat', chatReducer),
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    ChatModuleRoutingModule,
    FormsModule,
    RouterModule,
    ReactiveFormsModule,
    SharedModule,
    RoomsModule,
    CommunitiesModule,
    NgOptimizedImage,
    BaseModalComponent,
    TimeAgoPipe,
    DateFormatPipe,
  ],
})
export class ChatModule {}
