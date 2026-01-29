import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { ChatListComponent } from './features/chat/chat-list/chat-list.component';
import { ChatWindowComponent } from './features/chat/chat-window/chat-window.component';
import { Chat } from './core/services/whatsapp.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `<router-outlet></router-outlet>`,
  styles: [`
    :host {
      display: block;
      height: 100vh;
    }
  `]
})
export class App { }

@Component({
  selector: 'app-main-chat',
  standalone: true,
  imports: [CommonModule, ChatListComponent, ChatWindowComponent],
  template: `
    <div class="main-container">
      <aside class="sidebar">
        <app-chat-list (chatSelected)="onChatSelected($event)"></app-chat-list>
      </aside>
      <main class="chat-area">
        <app-chat-window [chat]="selectedChat"></app-chat-window>
      </main>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
    }
    
    .main-container {
      display: flex;
      height: 100vh;
      max-height: 100vh;
      background: #111b21;
      overflow: hidden;
    }
    
    .sidebar {
      width: 400px;
      min-width: 300px;
      max-width: 500px;
      height: 100%;
      border-right: 1px solid #2a3942;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .chat-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      overflow: hidden;
    }
    
    @media (max-width: 768px) {
      .sidebar {
        width: 100%;
        max-width: none;
      }
      
      .chat-area {
        display: none;
      }
      
      .main-container.chat-open {
        .sidebar {
          display: none;
        }
        
        .chat-area {
          display: flex;
        }
      }
    }
  `]
})
export class MainChatComponent {
  selectedChat: Chat | null = null;

  onChatSelected(chat: Chat): void {
    this.selectedChat = chat;
  }
}
