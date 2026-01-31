import { Component, OnInit, OnDestroy, Output, EventEmitter, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, interval, Subject } from 'rxjs';
import { filter, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { WhatsappService, Chat, SearchResult } from '../../../core/services/whatsapp.service';
import { FilterService } from '../../../core/services/filter.service';
import { SocketService } from '../../../core/services/socket.service';
import { AccountService, Account } from '../../../core/services/account.service';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';

@Component({
  selector: 'app-chat-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TimeAgoPipe],
  templateUrl: './chat-list.component.html',
  styleUrl: './chat-list.component.scss'
})
export class ChatListComponent implements OnInit, OnDestroy {
  @Output() chatSelected = new EventEmitter<Chat>();

  chats = signal<Chat[]>([]);
  searchResults = signal<SearchResult[]>([]);
  isLoading = signal(true);
  isSearching = signal(false);
  isSyncing = signal(false);
  syncProgress = signal('');
  searchQuery = '';
  selectedChatId: string | null = null;
  showFilters = false;
  showSearchResults = false;
  isLoggingOut = false;

  // Account dropdown
  showAccountMenu = false;
  showAddAccountModal = false;
  newAccountName = '';

  private subscriptions: Subscription[] = [];
  private refreshInterval: Subscription | null = null;
  private searchSubject = new Subject<string>();

  // Profile picture cache
  profilePicCache = new Map<string, string | null>();
  private profilePicFetchQueue: string[] = [];
  private isFetchingPics = false;

  // Account getters
  get accounts() { return this.accountService.accounts; }
  get activeAccount() { return this.accountService.activeAccount; }

  constructor(
    private whatsappService: WhatsappService,
    public filterService: FilterService,
    private socketService: SocketService,
    private accountService: AccountService,
    private router: Router
  ) {
    this.subscriptions.push(
      this.searchSubject.pipe(
        debounceTime(500),
        distinctUntilChanged()
      ).subscribe(query => {
        this.performSearch(query);
      })
    );
  }

  ngOnInit(): void {
    this.subscriptions.push(
      this.socketService.syncing$.subscribe(syncing => {
        if (syncing) {
          this.isSyncing.set(true);
          this.syncProgress.set('جاري مزامنة المحادثات...');
        }
      })
    );

    this.subscriptions.push(
      this.socketService.loadingProgress$.subscribe(progress => {
        if (progress) {
          this.syncProgress.set(`جاري التحميل... ${progress.percent}%`);
        }
      })
    );

    this.subscriptions.push(
      this.socketService.message$.pipe(
        filter(message => message !== null)
      ).subscribe(() => {
        // Reload chats immediately when new message arrives
        this.loadChats();
      })
    );

    this.subscriptions.push(
      this.socketService.messageSent$.pipe(
        filter(message => message !== null)
      ).subscribe(() => {
        // Reload chats immediately when message is sent
        this.loadChats();
      })
    );

    this.subscriptions.push(
      this.socketService.status$.subscribe(status => {
        if (status.isReady && !status.isSyncing) {
          this.loadChats();
        }
      })
    );

    this.loadChats();
    this.accountService.loadAccounts(); // Load accounts on init

    // Reduced polling interval to 15 seconds to decrease server load
    this.refreshInterval = interval(15000).subscribe(() => {
      this.loadChats();
      this.accountService.loadAccounts(); // Refresh accounts periodically
    });
  }

  loadChats(): void {
    if (this.chats().length === 0) {
      this.isLoading.set(true);
    }
    const filters = this.filterService.filters();

    this.whatsappService.getChats({
      ...filters,
      search: this.searchQuery || filters.search
    }).subscribe({
      next: (response) => {
        if (response.success && response.chats) {
          this.chats.set(response.chats);

          if (response.chats.length > 0) {
            this.isSyncing.set(false);
            this.syncProgress.set('');
            // Load profile pictures for visible chats
            this.loadProfilePictures(response.chats.slice(0, 15));
          } else if (this.isSyncing()) {
            this.syncProgress.set('جاري تحميل المحادثات... الرجاء الانتظار');
          }
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading chats:', err);
        this.isLoading.set(false);
      }
    });
  }

  // Load profile pictures for chats
  loadProfilePictures(chats: Chat[]): void {
    for (const chat of chats) {
      // Skip if already cached or already in queue
      if (this.profilePicCache.has(chat.id) || this.profilePicFetchQueue.includes(chat.id)) {
        continue;
      }
      this.profilePicFetchQueue.push(chat.id);
    }
    this.processProfilePicQueue();
  }

  private processProfilePicQueue(): void {
    if (this.isFetchingPics || this.profilePicFetchQueue.length === 0) {
      return;
    }

    this.isFetchingPics = true;
    const chatId = this.profilePicFetchQueue.shift()!;

    this.whatsappService.getProfilePicture(chatId).subscribe({
      next: (response) => {
        if (response.profilePicUrl) {
          this.profilePicCache.set(chatId, response.profilePicUrl);
          // Update the chat in the list
          const chats = this.chats();
          const chatIndex = chats.findIndex(c => c.id === chatId);
          if (chatIndex >= 0) {
            chats[chatIndex].profilePicUrl = response.profilePicUrl;
            this.chats.set([...chats]);
          }
        } else {
          this.profilePicCache.set(chatId, null);
        }
        this.isFetchingPics = false;
        // Process next in queue with a small delay
        setTimeout(() => this.processProfilePicQueue(), 100);
      },
      error: () => {
        this.profilePicCache.set(chatId, null);
        this.isFetchingPics = false;
        setTimeout(() => this.processProfilePicQueue(), 100);
      }
    });
  }

  onSearchInput(): void {
    const query = this.searchQuery.trim();
    if (query.length >= 2) {
      this.showSearchResults = true;
      this.searchSubject.next(query);
    } else {
      this.showSearchResults = false;
      this.searchResults.set([]);
      this.filterService.updateFilter('search', query);
      this.loadChats();
    }
  }

  performSearch(query: string): void {
    if (!query || query.length < 2) {
      this.searchResults.set([]);
      this.showSearchResults = false;
      return;
    }

    this.isSearching.set(true);
    this.whatsappService.search(query).subscribe({
      next: (response) => {
        if (response.success) {
          this.searchResults.set(response.results);
        }
        this.isSearching.set(false);
      },
      error: (err) => {
        console.error('Search error:', err);
        this.isSearching.set(false);
      }
    });
  }

  selectSearchResult(result: SearchResult): void {
    const chat = this.chats().find(c => c.id === result.chatId);
    if (chat) {
      this.selectChat(chat);
    } else {
      this.whatsappService.getChats({
        chatType: 'all',
        readStatus: 'all',
        dateRange: 'all',
        replyStatus: 'all',
        search: ''
      }).subscribe({
        next: (response) => {
          if (response.success && response.chats) {
            const foundChat = response.chats.find(c => c.id === result.chatId);
            if (foundChat) {
              this.selectChat(foundChat);
            }
          }
        }
      });
    }
    this.clearSearch();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.showSearchResults = false;
    this.searchResults.set([]);
    this.filterService.updateFilter('search', '');
    this.loadChats();
  }

  selectChat(chat: Chat): void {
    this.selectedChatId = chat.id;
    this.chatSelected.emit(chat);
  }

  onSearch(): void {
    this.filterService.updateFilter('search', this.searchQuery);
    this.loadChats();
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  applyFilter(filterType: string, value: string): void {
    switch (filterType) {
      case 'chatType':
        this.filterService.updateFilter('chatType', value as any);
        break;
      case 'readStatus':
        this.filterService.updateFilter('readStatus', value as any);
        break;
      case 'dateRange':
        this.filterService.updateFilter('dateRange', value as any);
        break;
      case 'replyStatus':
        this.filterService.updateFilter('replyStatus', value as any);
        break;
      case 'contactType':
        this.filterService.updateFilter('contactType', value as any);
        // When selecting "New Contacts", automatically apply "Today" filter
        // because new contacts are defined as people who contacted for the first time today
        if (value === 'new') {
          this.filterService.updateFilter('dateRange', 'today');
        }
        break;
    }
    this.loadChats();
  }

  clearFilters(): void {
    this.filterService.resetFilters();
    this.searchQuery = '';
    this.showSearchResults = false;
    this.searchResults.set([]);
    this.loadChats();
  }

  getInitials(name: string): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  truncateMessage(message: string | null, maxLength: number = 45): string {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  }

  highlightMatch(text: string, query: string): string {
    if (!query || !text) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  formatSearchTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
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

    // Generate consistent color based on name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  }

  // Handle image load error
  onImageError(event: Event, chat: Chat): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    // Mark that image failed so we show initials
    chat.profilePicUrl = null;
  }

  logout(): void {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;

    this.whatsappService.logout().subscribe({
      next: () => {
        this.router.navigate(['/auth']);
      },
      error: (err) => {
        console.error('Logout error:', err);
        this.router.navigate(['/auth']);
      }
    });
  }

  refreshChats(): void {
    this.loadChats();
  }

  goToAnalytics(): void {
    this.router.navigate(['/analytics']);
  }

  // Account Management Methods
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.account-dropdown')) {
      this.showAccountMenu = false;
    }
  }

  toggleAccountMenu(event: Event): void {
    event.stopPropagation();
    this.showAccountMenu = !this.showAccountMenu;
  }

  getAccountInitials(): string {
    const account = this.activeAccount();
    if (!account) return '?';
    return account.name.charAt(0).toUpperCase();
  }

  getAccountStatusText(account: Account | null | undefined): string {
    if (!account) return 'Not connected';

    // If phone is available, show it
    if (account.phone) {
      return '+' + account.phone;
    }

    // If ready but no phone, show connected
    if (account.isReady) {
      return 'Connected';
    }

    // If initializing, show connecting
    if (account.isInitializing) {
      return 'Connecting...';
    }

    // If authenticated but not ready, show syncing
    if (account.isAuthenticated) {
      return 'Syncing...';
    }

    // If has QR code, show scan QR
    if (account.hasQR) {
      return 'Scan QR';
    }

    // Default: not connected
    return 'Not connected';
  }

  switchToAccount(accountId: string): void {
    if (this.activeAccount()?.id === accountId) {
      this.showAccountMenu = false;
      return;
    }

    this.accountService.switchAccount(accountId).subscribe({
      next: (response) => {
        if (response.success) {
          this.showAccountMenu = false;

          // Use account data from response if available
          const account = response.account || response.status;

          if (account && account.isReady) {
            // Account is ready, just reload chats
            this.loadChats();
          } else if (account && account.isAuthenticated) {
            // Account is authenticated (connected), stay here and load chats
            this.loadChats();
          } else if (account && account.isInitializing) {
            // Account is initializing, stay here
            this.isSyncing.set(true);
            this.syncProgress.set('جاري تهيئة الحساب...');
            this.loadChats();
          } else {
            // Account needs QR scanning (not authenticated and not initializing)
            this.router.navigate(['/auth']);
          }
        }
      },
      error: (err) => {
        console.error('Error switching account:', err);
      }
    });
  }

  openAddAccountModal(): void {
    this.showAddAccountModal = true;
    this.showAccountMenu = false;
    this.newAccountName = '';
  }

  closeAddAccountModal(): void {
    this.showAddAccountModal = false;
    this.newAccountName = '';
  }

  createNewAccount(): void {
    if (!this.newAccountName.trim()) return;

    const accountName = this.newAccountName.trim();
    this.closeAddAccountModal();

    this.accountService.createAccount(accountName).subscribe({
      next: (response) => {
        if (response.success && response.account) {
          // Switch to the new account
          this.accountService.switchAccount(response.account.id).subscribe({
            next: () => {
              // Redirect to auth page to show QR for scanning
              // Use setTimeout to ensure account is set before navigating
              setTimeout(() => {
                this.router.navigate(['/auth']);
              }, 100);
            },
            error: (err) => {
              console.error('Error switching to new account:', err);
              // Still navigate to auth even if switch fails
              this.router.navigate(['/auth']);
            }
          });
        }
      },
      error: (err) => {
        console.error('Error creating account:', err);
      }
    });
  }

  deleteAccount(event: Event, accountId: string): void {
    event.stopPropagation(); // Prevent switching to account

    // Simple confirmation
    if (!confirm('هل أنت متأكد من حذف هذا الحساب؟ سيتم حذف جميع البيانات المرتبطة به.')) {
      return;
    }

    this.accountService.deleteAccount(accountId).subscribe({
      next: (response) => {
        if (response.success) {
          // If deleted account was active, check if there are other accounts
          if (this.activeAccount()?.id === accountId) {
            const remainingAccounts = this.accounts().filter(a => a.id !== accountId);
            if (remainingAccounts.length > 0) {
              // Switch to first remaining account
              this.switchToAccount(remainingAccounts[0].id);
            } else {
              // No accounts left, redirect to auth
              this.router.navigate(['/auth']);
            }
          }
        }
      },
      error: (err) => {
        console.error('Error deleting account:', err);
        alert('حدث خطأ أثناء حذف الحساب');
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.refreshInterval?.unsubscribe();
  }
}
