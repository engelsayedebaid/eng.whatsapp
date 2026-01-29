import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Message, WhatsappService } from '../../../core/services/whatsapp.service';

@Component({
  selector: 'app-message-bubble',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.scss'
})
export class MessageBubbleComponent {
  @Input() message!: Message;
  @Input() showTail = true;
  @Input() chatId: string = '';

  showModal = false;
  showMediaModal = false;
  mediaLoading = false;
  mediaUrl: string | null = null;
  mediaError: string | null = null;

  // Colors for different authors (based on hash of phone number)
  private authorColors = [
    '#53bdeb', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
    '#2196f3', '#00bcd4', '#009688', '#4caf50', '#8bc34a',
    '#ff9800', '#ff5722', '#795548', '#607d8b', '#e91e63'
  ];

  constructor(private whatsappService: WhatsappService) { }

  get formattedTime(): string {
    const date = new Date(this.message.timestamp * 1000);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  get ackStatus(): string {
    switch (this.message.ack) {
      case 0: return 'pending';
      case 1: return 'sent';
      case 2: return 'delivered';
      case 3: return 'read';
      default: return 'unknown';
    }
  }

  // Media type helpers
  get isImage(): boolean {
    return this.message.type === 'image' ||
      (this.message.hasMedia && this.message.mediaInfo?.mimetype?.startsWith('image/') || false);
  }

  get isVideo(): boolean {
    return this.message.type === 'video' ||
      (this.message.hasMedia && this.message.mediaInfo?.mimetype?.startsWith('video/') || false);
  }

  get isAudio(): boolean {
    return this.message.type === 'audio' || this.message.type === 'ptt' ||
      (this.message.hasMedia && this.message.mediaInfo?.mimetype?.startsWith('audio/') || false);
  }

  get isDocument(): boolean {
    return this.message.type === 'document' ||
      (this.message.hasMedia && !this.isImage && !this.isVideo && !this.isAudio && !this.isSticker);
  }

  get isSticker(): boolean {
    return this.message.type === 'sticker';
  }

  get isVoiceNote(): boolean {
    return this.message.type === 'ptt';
  }

  get mediaCaption(): string {
    return this.message.mediaInfo?.caption || this.message.body || '';
  }

  get mediaDuration(): string {
    const duration = this.message.mediaInfo?.duration;
    if (!duration) return '';
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  get mediaFilename(): string {
    return this.message.mediaInfo?.filename || 'Download';
  }

  get mediaFilesize(): string {
    const size = this.message.mediaInfo?.filesize;
    if (!size) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Load media on demand
  loadMedia(): void {
    if (this.mediaLoading || this.mediaUrl) return;

    this.mediaLoading = true;
    this.mediaError = null;

    this.whatsappService.getMedia(this.message.id).subscribe({
      next: (response) => {
        if (response.success && response.media) {
          this.mediaUrl = `data:${response.media.mimetype};base64,${response.media.data}`;
        } else {
          this.mediaError = response.message || 'Could not load media';
        }
        this.mediaLoading = false;
      },
      error: (err) => {
        this.mediaError = 'Failed to load media';
        this.mediaLoading = false;
      }
    });
  }

  openMediaModal(): void {
    this.loadMedia();
    this.showMediaModal = true;
  }

  closeMediaModal(): void {
    this.showMediaModal = false;
  }

  downloadMedia(): void {
    if (!this.mediaUrl) {
      this.loadMedia();
      return;
    }

    const link = document.createElement('a');
    link.href = this.mediaUrl;
    link.download = this.mediaFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  getAuthorDisplayName(): string {
    if (this.message.authorInfo) {
      if (this.message.authorInfo.name) {
        return this.message.authorInfo.name;
      }
      // Format phone number
      return '+' + this.message.authorInfo.number;
    }
    return this.formatAuthor(this.message.author);
  }

  getAuthorInitials(): string {
    if (this.message.authorInfo?.name) {
      return this.message.authorInfo.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
    }
    // Use last 2 digits of phone number
    if (this.message.authorInfo?.number) {
      return this.message.authorInfo.number.slice(-2);
    }
    return '?';
  }

  getAuthorColor(): string {
    const id = this.message.authorInfo?.number || this.message.author || '';
    const hash = this.hashString(id);
    return this.authorColors[hash % this.authorColors.length];
  }

  formatAuthor(author: string | null): string {
    if (!author) return '';
    // Remove @c.us or @s.whatsapp.net suffix and format
    const number = author.split('@')[0];
    // If it's a phone number, format it
    if (/^\d+$/.test(number)) {
      return '+' + number;
    }
    return number;
  }

  openImageModal(): void {
    if (this.message.authorInfo) {
      this.showModal = true;
    }
  }

  closeImageModal(): void {
    this.showModal = false;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

