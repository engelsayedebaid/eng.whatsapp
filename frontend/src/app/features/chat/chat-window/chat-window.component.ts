import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { filter } from 'rxjs/operators';
import { WhatsappService, Chat, Message } from '../../../core/services/whatsapp.service';
import { SocketService } from '../../../core/services/socket.service';
import { MessageBubbleComponent } from '../message-bubble/message-bubble.component';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule, MessageBubbleComponent],
  templateUrl: './chat-window.component.html',
  styleUrl: './chat-window.component.scss'
})
export class ChatWindowComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @Input() chat: Chat | null = null;
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  messages = signal<Message[]>([]);
  isLoading = signal(false);
  isOnline = signal(false);
  lastSeen = signal<number | null>(null);
  newMessage = '';
  isSending = false;
  showScrollToBottom = false;
  private shouldScrollToBottom = false;
  private subscriptions: Subscription[] = [];
  private presenceInterval: Subscription | null = null;
  private messageRefreshInterval: Subscription | null = null;

  constructor(
    private whatsappService: WhatsappService,
    private socketService: SocketService
  ) {
    // Listen for new incoming messages - no debounce for instant updates
    this.subscriptions.push(
      this.socketService.message$.pipe(
        filter(msg => msg !== null)
      ).subscribe(msg => {
        if (msg && this.chat) {
          // For groups, msg.from is the group ID
          // For individual chats, compare the phone number part
          const isGroupChat = this.chat.isGroup;

          if (isGroupChat) {
            // For groups, compare full chat ID
            if (msg.from === this.chat.id) {
              console.log('New group message received, refreshing...');
              this.refreshMessages();
            }
          } else {
            // For individual chats, compare phone numbers
            const chatNumber = this.chat.id.split('@')[0];
            const msgNumber = msg.from.split('@')[0];
            if (msgNumber === chatNumber || msg.from === this.chat.id) {
              console.log('New message received for this chat, refreshing...');
              this.refreshMessages();
            }
          }
        }
      })
    );

    // Listen for sent messages to update immediately
    this.subscriptions.push(
      this.socketService.messageSent$.pipe(
        filter(msg => msg !== null)
      ).subscribe(msg => {
        if (msg && this.chat) {
          // Check if message was sent to this chat
          const chatNumber = this.chat.id.split('@')[0];
          const msgNumber = msg.to.split('@')[0];
          if (msgNumber === chatNumber || msg.to === this.chat.id) {
            console.log('Message sent to this chat, refreshing...');
            this.refreshMessages();
          }
        }
      })
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chat'] && this.chat) {
      this.loadMessages();
      this.loadPresence();
      this.startPresencePolling();
      this.startMessageRefresh();
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.presenceInterval?.unsubscribe();
    this.messageRefreshInterval?.unsubscribe();
  }

  loadMessages(forceReload: boolean = true): void {
    if (!this.chat) return;

    // Only show loading on initial load
    if (forceReload) {
      this.isLoading.set(true);
    }

    this.whatsappService.getMessages(this.chat.id, 100).subscribe({
      next: (response) => {
        if (response.success && response.messages) {
          if (forceReload) {
            // Full reload - replace all messages
            this.messages.set(response.messages);
            this.shouldScrollToBottom = true;
          } else {
            // Smart update - only add new messages
            const currentMessages = this.messages();
            const currentIds = new Set(currentMessages.map(m => m.id));
            const newMessages = response.messages.filter(m => !currentIds.has(m.id));

            if (newMessages.length > 0) {
              // Add new messages to the end
              this.messages.update(msgs => [...msgs, ...newMessages]);
              this.shouldScrollToBottom = true;
            }
          }
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading messages:', err);
        this.isLoading.set(false);
      }
    });
  }

  // Refresh messages without full reload (for auto-refresh)
  refreshMessages(): void {
    this.loadMessages(false);
  }

  loadPresence(): void {
    if (!this.chat || this.chat.isGroup) {
      this.isOnline.set(false);
      this.lastSeen.set(null);
      return;
    }

    this.whatsappService.getPresence(this.chat.id).subscribe({
      next: (response) => {
        if (response.success && response.presence) {
          this.isOnline.set(response.presence.isOnline);
          this.lastSeen.set(response.presence.lastSeen);
        }
      },
      error: (err) => {
        console.log('Could not get presence:', err);
      }
    });
  }

  startPresencePolling(): void {
    // Stop previous interval
    this.presenceInterval?.unsubscribe();

    // Poll presence every 30 seconds for individual chats
    if (this.chat && !this.chat.isGroup) {
      this.presenceInterval = interval(30000).subscribe(() => {
        this.loadPresence();
      });
    }
  }

  startMessageRefresh(): void {
    // Stop previous interval
    this.messageRefreshInterval?.unsubscribe();

    // Refresh messages every 5 seconds as fallback for real-time updates
    // Uses smart refresh that only adds new messages
    if (this.chat) {
      this.messageRefreshInterval = interval(5000).subscribe(() => {
        this.refreshMessages();
      });
    }
  }

  scrollToTop(): void {
    if (this.messagesContainer) {
      this.messagesContainer.nativeElement.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }

  scrollToBottom(): void {
    if (this.messagesContainer) {
      const container = this.messagesContainer.nativeElement;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
      this.showScrollToBottom = false;
    }
  }

  onScroll(): void {
    if (this.messagesContainer) {
      const container = this.messagesContainer.nativeElement;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      // Show button if scrolled up more than 200px from bottom
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      this.showScrollToBottom = distanceFromBottom > 200;
    }
  }

  togglePin(): void {
    if (!this.chat) return;

    if (this.chat.isPinned) {
      this.whatsappService.unpinChat(this.chat.id).subscribe({
        next: () => {
          if (this.chat) this.chat.isPinned = false;
        },
        error: (err) => console.error('Error unpinning chat:', err)
      });
    } else {
      this.whatsappService.pinChat(this.chat.id).subscribe({
        next: () => {
          if (this.chat) this.chat.isPinned = true;
        },
        error: (err) => console.error('Error pinning chat:', err)
      });
    }
  }

  toggleArchive(): void {
    if (!this.chat) return;

    if (this.chat.isArchived) {
      this.whatsappService.unarchiveChat(this.chat.id).subscribe({
        next: () => {
          if (this.chat) this.chat.isArchived = false;
        },
        error: (err) => console.error('Error unarchiving chat:', err)
      });
    } else {
      this.whatsappService.archiveChat(this.chat.id).subscribe({
        next: () => {
          if (this.chat) this.chat.isArchived = true;
        },
        error: (err) => console.error('Error archiving chat:', err)
      });
    }
  }

  formatLastSeen(timestamp: number): string {
    const now = Date.now();
    const lastSeenTime = timestamp * 1000;
    const diff = now - lastSeenTime;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

    return new Date(lastSeenTime).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  sendMessage(): void {
    if (!this.chat || !this.newMessage.trim() || this.isSending) return;

    const messageText = this.newMessage.trim();
    this.newMessage = '';
    this.isSending = true;

    // Optimistically add the message to the UI
    const optimisticMessage: Message = {
      id: 'temp_' + Date.now(),
      body: messageText,
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: true,
      author: null,
      authorInfo: null,
      type: 'chat',
      hasMedia: false,
      mediaInfo: null,
      isForwarded: false,
      isStatus: false,
      isStarred: false,
      isDeleted: false,
      ack: 0,
      mentionedIds: [],
      quotedMsg: null
    };
    this.messages.update(msgs => [...msgs, optimisticMessage]);
    this.shouldScrollToBottom = true;

    this.whatsappService.sendMessage(this.chat.id, messageText).subscribe({
      next: (response) => {
        if (response.success) {
          // Reload messages to get the real message with proper ID
          this.loadMessages();
        }
        this.isSending = false;
      },
      error: (err) => {
        console.error('Error sending message:', err);
        // Remove optimistic message and restore input
        this.messages.update(msgs => msgs.filter(m => m.id !== optimisticMessage.id));
        this.newMessage = messageText;
        this.isSending = false;
      }
    });
  }

  getInitials(name: string): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  // Avatar gradient colors based on name
  getAvatarGradient(name: string): string {
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
      'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
      'linear-gradient(135deg, #fc4a1a 0%, #f7b733 100%)',
      'linear-gradient(135deg, #00c6fb 0%, #005bea 100%)'
    ];

    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  }

  // Handle image load error
  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    if (this.chat) {
      this.chat.profilePicUrl = null;
    }
  }

  shouldShowTail(index: number): boolean {
    const msgs = this.messages();
    if (index === msgs.length - 1) return true;
    return msgs[index].fromMe !== msgs[index + 1].fromMe;
  }

  getDateSeparator(index: number): string | null {
    const msgs = this.messages();
    const currentMsg = msgs[index];
    const prevMsg = index > 0 ? msgs[index - 1] : null;

    const currentDate = new Date(currentMsg.timestamp * 1000).toDateString();
    const prevDate = prevMsg ? new Date(prevMsg.timestamp * 1000).toDateString() : null;

    if (!prevDate || currentDate !== prevDate) {
      const date = new Date(currentMsg.timestamp * 1000);
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();

      if (currentDate === today) return 'Today';
      if (currentDate === yesterday) return 'Yesterday';
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    return null;
  }
}

