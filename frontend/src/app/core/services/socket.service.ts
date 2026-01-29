import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ConnectionStatus {
  isReady: boolean;
  isAuthenticated: boolean;
  hasQR: boolean;
  isSyncing?: boolean;
}

export interface QRData {
  qrCode: string;
  qrRaw: string;
}

export interface IncomingMessage {
  id: string;
  body: string;
  from: string;
  timestamp: number;
  fromMe: boolean;
  type: string;
}

export interface SentMessage {
  id: string;
  body: string;
  to: string;
  timestamp: number;
  type: string;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private readonly API_URL = 'http://localhost:3000';

  private statusSubject = new BehaviorSubject<ConnectionStatus>({
    isReady: false,
    isAuthenticated: false,
    hasQR: false,
    isSyncing: false
  });

  private qrSubject = new BehaviorSubject<QRData | null>(null);
  private messageSubject = new BehaviorSubject<IncomingMessage | null>(null);
  private messageSentSubject = new BehaviorSubject<SentMessage | null>(null);
  private connectedSubject = new BehaviorSubject<boolean>(false);
  private syncingSubject = new BehaviorSubject<boolean>(false);
  private loadingProgressSubject = new BehaviorSubject<{ percent: number; message: string } | null>(null);

  status$ = this.statusSubject.asObservable();
  qr$ = this.qrSubject.asObservable();
  message$ = this.messageSubject.asObservable();
  messageSent$ = this.messageSentSubject.asObservable();
  connected$ = this.connectedSubject.asObservable();
  syncing$ = this.syncingSubject.asObservable();
  loadingProgress$ = this.loadingProgressSubject.asObservable();

  constructor() {
    this.connect();
  }

  private connect(): void {
    this.socket = io(this.API_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.connectedSubject.next(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.connectedSubject.next(false);
    });

    this.socket.on('status', (status: ConnectionStatus) => {
      console.log('Status update:', status);
      this.statusSubject.next(status);
      // Update syncing status
      if (status.isAuthenticated && !status.isReady) {
        this.syncingSubject.next(true);
      } else if (status.isReady) {
        this.syncingSubject.next(false);
      }
    });

    this.socket.on('qr', (qr: QRData) => {
      console.log('QR received');
      this.qrSubject.next(qr);
    });

    this.socket.on('loading', (data: { percent: number; message: string }) => {
      console.log(`WhatsApp loading: ${data.percent}% - ${data.message}`);
      this.syncingSubject.next(true);
      // Emit loading progress for UI
      this.loadingProgressSubject.next(data);
    });

    this.socket.on('ready', () => {
      console.log('WhatsApp ready');
      this.qrSubject.next(null);
      // Don't set syncing to false here - let it remain true until chats are loaded
      // The chat list component will handle showing chats as they arrive
    });

    this.socket.on('authenticated', () => {
      console.log('WhatsApp authenticated');
      this.syncingSubject.next(true); // Start syncing after auth
    });

    this.socket.on('auth_failure', (data: any) => {
      console.error('Auth failure:', data);
      this.syncingSubject.next(false);
    });

    this.socket.on('disconnected', (data: any) => {
      console.log('WhatsApp disconnected:', data);
      this.syncingSubject.next(false);
    });

    this.socket.on('message', (message: IncomingMessage) => {
      console.log('New message:', message);
      this.messageSubject.next(message);
    });

    this.socket.on('message_sent', (message: SentMessage) => {
      console.log('Message sent:', message);
      this.messageSentSubject.next(message);
    });

    this.socket.on('init_failure', (data: any) => {
      console.error('Init failure:', data);
      this.syncingSubject.next(false);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  // Get current syncing status
  isSyncing(): boolean {
    return this.syncingSubject.value;
  }

  // Get current status
  getStatus(): ConnectionStatus {
    return this.statusSubject.value;
  }
}
