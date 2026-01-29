import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface Account {
  id: string;
  name: string;
  phone: string | null;
  createdAt: number;
  isReady: boolean;
  isAuthenticated: boolean;
  isInitializing: boolean;
  hasQR: boolean;
  isActive: boolean;
}

export interface AccountResponse {
  success: boolean;
  accounts?: Account[];
  account?: Account;
  status?: Account;
  message?: string;
  error?: string;
}

export interface QRResponse {
  success: boolean;
  qrCode?: string;
  qrRaw?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private readonly API_URL = 'http://localhost:3000/api';

  // Signals for reactive state
  private accountsSignal = signal<Account[]>([]);
  private activeAccountSignal = signal<Account | null>(null);
  private isLoadingSignal = signal(false);

  // Public readonly signals
  readonly accounts = this.accountsSignal.asReadonly();
  readonly activeAccount = this.activeAccountSignal.asReadonly();
  readonly isLoading = this.isLoadingSignal.asReadonly();

  // Computed signals
  readonly accountCount = computed(() => this.accountsSignal().length);
  readonly hasAccounts = computed(() => this.accountsSignal().length > 0);
  readonly canAddMore = computed(() => this.accountsSignal().length < 10);

  // Event emitter for account changes
  private accountChanged$ = new BehaviorSubject<string | null>(null);
  readonly accountChanged = this.accountChanged$.asObservable();

  constructor(private http: HttpClient) {
    this.loadAccounts();
  }

  /**
   * Load all accounts from server
   */
  loadAccounts(): void {
    this.isLoadingSignal.set(true);
    this.http.get<AccountResponse>(`${this.API_URL}/accounts`).subscribe({
      next: (response) => {
        if (response.success && response.accounts) {
          this.accountsSignal.set(response.accounts);
          const active = response.accounts.find(a => a.isActive);
          this.activeAccountSignal.set(active || null);
        }
        this.isLoadingSignal.set(false);
      },
      error: (err) => {
        console.error('Error loading accounts:', err);
        this.isLoadingSignal.set(false);
      }
    });
  }

  /**
   * Create a new account
   */
  createAccount(name: string): Observable<AccountResponse> {
    return this.http.post<AccountResponse>(`${this.API_URL}/accounts`, { name }).pipe(
      tap(response => {
        if (response.success) {
          this.loadAccounts();
        }
      })
    );
  }

  /**
   * Delete an account
   */
  deleteAccount(accountId: string): Observable<AccountResponse> {
    return this.http.delete<AccountResponse>(`${this.API_URL}/accounts/${accountId}`).pipe(
      tap(response => {
        if (response.success) {
          this.loadAccounts();
        }
      })
    );
  }

  /**
   * Rename an account
   */
  renameAccount(accountId: string, name: string): Observable<AccountResponse> {
    return this.http.put<AccountResponse>(`${this.API_URL}/accounts/${accountId}`, { name }).pipe(
      tap(response => {
        if (response.success) {
          this.loadAccounts();
        }
      })
    );
  }

  /**
   * Switch to a different account
   */
  switchAccount(accountId: string): Observable<AccountResponse> {
    return this.http.post<AccountResponse>(`${this.API_URL}/accounts/${accountId}/switch`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.loadAccounts();
          this.accountChanged$.next(accountId);
        }
      })
    );
  }

  /**
   * Initialize an account (start WhatsApp client)
   */
  initializeAccount(accountId: string): Observable<AccountResponse> {
    return this.http.post<AccountResponse>(`${this.API_URL}/accounts/${accountId}/initialize`, {});
  }

  /**
   * Get account status
   */
  getAccountStatus(accountId: string): Observable<AccountResponse> {
    return this.http.get<AccountResponse>(`${this.API_URL}/accounts/${accountId}/status`);
  }

  /**
   * Get QR code for an account
   */
  getQRCode(accountId: string): Observable<QRResponse> {
    return this.http.get<QRResponse>(`${this.API_URL}/accounts/${accountId}/qr`);
  }

  /**
   * Logout from an account
   */
  logoutAccount(accountId: string): Observable<AccountResponse> {
    return this.http.post<AccountResponse>(`${this.API_URL}/accounts/${accountId}/logout`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.loadAccounts();
        }
      })
    );
  }

  /**
   * Get account by ID
   */
  getAccountById(accountId: string): Account | undefined {
    return this.accountsSignal().find(a => a.id === accountId);
  }

  /**
   * Format phone number for display
   */
  formatPhone(phone: string | null): string {
    if (!phone) return 'Not connected';
    return '+' + phone;
  }
}
