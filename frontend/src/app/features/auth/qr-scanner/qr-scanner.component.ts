import { Component, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SocketService } from '../../../core/services/socket.service';
import { WhatsappService } from '../../../core/services/whatsapp.service';
import { AccountService, Account } from '../../../core/services/account.service';

@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './qr-scanner.component.html',
  styleUrl: './qr-scanner.component.scss'
})
export class QrScannerComponent implements OnInit, OnDestroy {
  step: 'name' | 'qr' = 'name';
  accountName = '';
  currentAccountId: string | null = null;
  isCreating = false;

  qrCode: string | null = null;
  isLoading = true;
  isConnected = false;
  isAuthenticated = false;
  error: string | null = null;
  private isNavigating = false;

  private subscriptions: Subscription[] = [];
  private pollSubscription: Subscription | null = null;
  private statusPollSubscription: Subscription | null = null;

  constructor(
    private socketService: SocketService,
    private whatsappService: WhatsappService,
    public accountService: AccountService,
    private router: Router
  ) { }

  // Computed property to get connected accounts
  get connectedAccounts(): Account[] {
    return this.accountService.accounts().filter(acc => acc.isReady || acc.isAuthenticated);
  }

  ngOnInit(): void {
    // Refresh accounts first to get latest status
    this.accountService.loadAccounts();

    // Check active account after a delay to allow loadAccounts to complete
    // Use a longer delay to ensure the HTTP request has time to complete
    setTimeout(() => {
      this.checkActiveAccountAndSetup();
    }, 800);

    // Subscribe to socket events
    this.subscriptions.push(
      this.socketService.qr$.subscribe(qr => {
        if (qr) {
          this.qrCode = qr.qrCode;
          this.isLoading = false;
        }
      }),

      this.socketService.status$.subscribe(status => {
        console.log('Socket status update:', status);
        this.isAuthenticated = status.isAuthenticated;
        if (status.isReady) {
          this.navigateToChats();
        }
      }),

      this.socketService.connected$.subscribe(connected => {
        this.isConnected = connected;
      })
    );
  }

  private checkActiveAccountAndSetup(): void {
    const activeAccount = this.accountService.activeAccount();
    console.log('Checking active account:', activeAccount);

    if (activeAccount) {
      if (activeAccount.isReady) {
        // Account is fully connected - go to chats
        console.log('Account is ready, navigating to chats');
        this.router.navigate(['/chats']);
        return;
      } else if (activeAccount.isAuthenticated && !activeAccount.hasQR) {
        // Account is authenticated and syncing - go to chats to wait
        console.log('Account is authenticated and syncing, navigating to chats');
        this.router.navigate(['/chats']);
        return;
      } else {
        // Account exists but needs QR scanning (new account or disconnected)
        console.log('Account needs QR scanning, showing QR step');
        this.accountName = activeAccount.name;
        this.currentAccountId = activeAccount.id;
        this.step = 'qr';
        this.isLoading = true;
        this.startPolling();
        this.startStatusPolling();
      }
    } else {
      // No active account - show name input to create one
      console.log('No active account, showing name input');
      this.step = 'name';
    }
  }

  switchToConnectedAccount(account: Account): void {
    this.accountService.switchAccount(account.id).subscribe({
      next: (response) => {
        if (response.success) {
          this.router.navigate(['/chats']);
        }
      },
      error: (err) => {
        console.error('Error switching account:', err);
      }
    });
  }

  createAccountAndProceed(): void {
    if (!this.accountName.trim() || this.isCreating) return;

    this.isCreating = true;

    this.accountService.createAccount(this.accountName.trim()).subscribe({
      next: (response) => {
        if (response.success && response.account) {
          this.currentAccountId = response.account.id;
          // Switch to this account (this will initialize it)
          this.accountService.switchAccount(response.account.id).subscribe({
            next: () => {
              this.step = 'qr';
              this.isCreating = false;
              this.startPolling();
              this.startStatusPolling();
            },
            error: (err) => {
              console.error('Error switching account:', err);
              this.isCreating = false;
            }
          });
        }
      },
      error: (err) => {
        console.error('Error creating account:', err);
        this.error = 'Failed to create account';
        this.isCreating = false;
      }
    });
  }

  goBack(): void {
    this.step = 'name';
    this.qrCode = null;
    this.error = null;
    this.pollSubscription?.unsubscribe();
    this.statusPollSubscription?.unsubscribe();
  }

  private startPolling(): void {
    this.pollSubscription = interval(2000).pipe(
      switchMap(() => this.whatsappService.getQRCode())
    ).subscribe({
      next: (response) => {
        if (response.success && response.qrCode) {
          this.qrCode = response.qrCode;
          this.isLoading = false;
          this.error = null;
        } else if (!response.success) {
          this.checkStatus();
        }
      },
      error: (err) => {
        console.error('Error fetching QR:', err);
        this.error = 'Failed to connect to server. Please ensure the backend is running.';
        this.isLoading = false;
      }
    });
  }

  private startStatusPolling(): void {
    this.statusPollSubscription = interval(3000).pipe(
      switchMap(() => this.whatsappService.getStatus())
    ).subscribe({
      next: (status) => {
        console.log('Status poll:', status);
        if (status.isReady || status.isAuthenticated) {
          this.navigateToChats();
        }
      },
      error: (err) => {
        console.error('Error checking status:', err);
      }
    });
  }

  private checkStatus(): void {
    this.whatsappService.getStatus().subscribe({
      next: (status) => {
        console.log('Initial status check:', status);
        if (status.isReady || status.isAuthenticated) {
          this.navigateToChats();
        }
      }
    });
  }

  private navigateToChats(): void {
    if (this.isNavigating) return;
    this.isNavigating = true;

    console.log('Navigating to chats...');
    this.pollSubscription?.unsubscribe();
    this.statusPollSubscription?.unsubscribe();
    this.router.navigate(['/chats']);
  }

  refreshQR(): void {
    this.isLoading = true;
    this.error = null;
    this.whatsappService.getQRCode().subscribe({
      next: (response) => {
        if (response.success && response.qrCode) {
          this.qrCode = response.qrCode;
        }
        this.isLoading = false;
      },
      error: (err) => {
        this.error = 'Failed to refresh QR code';
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.pollSubscription?.unsubscribe();
    this.statusPollSubscription?.unsubscribe();
  }
}
