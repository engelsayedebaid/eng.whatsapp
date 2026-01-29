import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WhatsappService, Analytics, ChatAnalytics } from '../../core/services/whatsapp.service';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent implements OnInit {
  analytics = signal<Analytics | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);

  constructor(
    private whatsappService: WhatsappService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.loadAnalytics();
  }

  loadAnalytics(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.whatsappService.getAnalytics().subscribe({
      next: (response) => {
        if (response.success && response.analytics) {
          this.analytics.set(response.analytics);
        } else {
          this.error.set(response.message || 'Failed to load analytics');
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading analytics:', err);
        this.error.set('Failed to connect to server');
        this.isLoading.set(false);
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/chats']);
  }

  formatDate(timestamp: number): string {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getReplyStatusClass(chat: ChatAnalytics): string {
    if (chat.hasBeenReplied) return 'replied';
    if (chat.messagesReceived > 0) return 'pending';
    return 'no-messages';
  }
}
