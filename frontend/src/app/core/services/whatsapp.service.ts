import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  lastMessage: Message | null;
  profilePicUrl: string | null;
  isArchived: boolean;
  isPinned: boolean;
  isMuted: boolean;
  hasBeenReplied: boolean;
  messageCount: number;
  isFirstContact: boolean;
}

export interface Message {
  id: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  author: string | null;
  authorInfo: AuthorInfo | null;
  type: string;
  hasMedia: boolean;
  mediaInfo: MediaInfo | null;
  isForwarded: boolean;
  isStatus: boolean;
  isStarred: boolean;
  ack: number;
  mentionedIds: string[];
  quotedMsg: any;
}

export interface MediaInfo {
  mimetype: string | null;
  filename: string | null;
  filesize: number | null;
  caption: string | null;
  duration: number | null;
  isGif: boolean;
  isViewOnce: boolean;
  width: number | null;
  height: number | null;
}

export interface AuthorInfo {
  id: string;
  number: string;
  name: string | null;
  profilePicUrl: string | null;
}

export interface ChatFilters {
  chatType: 'all' | 'personal' | 'group';
  readStatus: 'all' | 'read' | 'unread';
  dateRange: 'all' | 'today' | 'week' | 'month';
  replyStatus: 'all' | 'replied' | 'not-replied';
  contactType: 'all' | 'new' | 'existing';
  search: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  count?: number;
  chats?: T;
  messages?: T;
  chat?: T;
}

export interface QRResponse {
  success: boolean;
  qrCode?: string;
  qrRaw?: string;
  message?: string;
}

export interface StatusResponse {
  success: boolean;
  isReady: boolean;
  isAuthenticated: boolean;
  hasQR: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class WhatsappService {
  private readonly API_URL = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  getQRCode(): Observable<QRResponse> {
    return this.http.get<QRResponse>(`${this.API_URL}/qr`);
  }

  getStatus(): Observable<StatusResponse> {
    return this.http.get<StatusResponse>(`${this.API_URL}/status`);
  }

  getChats(filters?: Partial<ChatFilters>): Observable<ApiResponse<Chat[]>> {
    let params = new HttpParams();

    if (filters) {
      if (filters.chatType) params = params.set('chatType', filters.chatType);
      if (filters.readStatus) params = params.set('readStatus', filters.readStatus);
      if (filters.dateRange) params = params.set('dateRange', filters.dateRange);
      if (filters.replyStatus) params = params.set('replyStatus', filters.replyStatus);
      if (filters.contactType) params = params.set('contactType', filters.contactType);
      if (filters.search) params = params.set('search', filters.search);
    }

    return this.http.get<ApiResponse<Chat[]>>(`${this.API_URL}/chats`, { params });
  }

  getChatById(chatId: string): Observable<ApiResponse<Chat>> {
    return this.http.get<ApiResponse<Chat>>(`${this.API_URL}/chats/${encodeURIComponent(chatId)}`);
  }

  getMessages(chatId: string, limit: number = 50): Observable<ApiResponse<Message[]>> {
    const params = new HttpParams().set('limit', limit.toString());
    return this.http.get<ApiResponse<Message[]>>(
      `${this.API_URL}/chats/${encodeURIComponent(chatId)}/messages`,
      { params }
    );
  }

  sendMessage(chatId: string, message: string): Observable<ApiResponse<Message>> {
    return this.http.post<ApiResponse<Message>>(
      `${this.API_URL}/chats/${encodeURIComponent(chatId)}/send`,
      { message }
    );
  }

  logout(): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/logout`, {});
  }

  getAnalytics(): Observable<AnalyticsResponse> {
    return this.http.get<AnalyticsResponse>(`${this.API_URL}/analytics`);
  }

  // Pin/Unpin chat
  pinChat(chatId: string): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/chats/${encodeURIComponent(chatId)}/pin`, {});
  }

  unpinChat(chatId: string): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/chats/${encodeURIComponent(chatId)}/unpin`, {});
  }

  // Archive/Unarchive chat
  archiveChat(chatId: string): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/chats/${encodeURIComponent(chatId)}/archive`, {});
  }

  unarchiveChat(chatId: string): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/chats/${encodeURIComponent(chatId)}/unarchive`, {});
  }

  // Get contact presence
  getPresence(contactId: string): Observable<PresenceResponse> {
    return this.http.get<PresenceResponse>(`${this.API_URL}/contacts/${encodeURIComponent(contactId)}/presence`);
  }

  // Search across all chats and messages
  search(query: string): Observable<SearchResponse> {
    return this.http.get<SearchResponse>(`${this.API_URL}/search?q=${encodeURIComponent(query)}`);
  }

  // Get media from message
  getMedia(messageId: string): Observable<MediaResponse> {
    return this.http.get<MediaResponse>(`${this.API_URL}/messages/${encodeURIComponent(messageId)}/media`);
  }

  // Get media download URL
  getMediaUrl(messageId: string, chatId: string): string {
    return `${this.API_URL}/messages/${encodeURIComponent(messageId)}/media/download?chatId=${encodeURIComponent(chatId)}`;
  }

  // Get profile picture for a chat
  getProfilePicture(chatId: string): Observable<ProfilePictureResponse> {
    return this.http.get<ProfilePictureResponse>(`${this.API_URL}/chats/${encodeURIComponent(chatId)}/picture`);
  }
}

export interface ProfilePictureResponse {
  success: boolean;
  profilePicUrl: string | null;
}

export interface MediaResponse {
  success: boolean;
  media?: {
    mimetype: string;
    data: string; // Base64
    filename: string | null;
    filesize: number | null;
  };
  message?: string;
}

export interface SearchResult {
  type: 'chat' | 'message';
  chatId: string;
  chatName: string;
  isGroup: boolean;
  messageId?: string;
  matchText: string;
  fromMe?: boolean;
  timestamp: number;
}

export interface SearchResponse {
  success: boolean;
  query?: string;
  count?: number;
  results: SearchResult[];
  message?: string;
}

export interface PresenceResponse {
  success: boolean;
  contact?: {
    id: string;
    name: string;
    number: string;
    isMyContact: boolean;
    isWAContact: boolean;
  };
  presence?: {
    isOnline: boolean;
    status: string;
    lastSeen: number | null;
  };
}

export interface AnalyticsResponse {
  success: boolean;
  message?: string;
  analytics?: Analytics;
}

export interface Analytics {
  overview: {
    totalChats: number;
    individualChats: number;
    groupChats: number;
    unreadChats: number;
    repliedChats: number;
    notRepliedChats: number;
    newContactsToday: number;
    replyRate: string;
    avgResponseTime: string;
    avgResponseTimeSeconds: number;
  };
  messages: {
    totalSent: number;
    totalReceived: number;
    total: number;
  };
  timeRange: {
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  topChats: ChatAnalytics[];
  pendingReplies: ChatAnalytics[];
}

export interface ChatAnalytics {
  id: string;
  name: string;
  isGroup: boolean;
  messagesSent: number;
  messagesReceived: number;
  totalMessages: number;
  hasBeenReplied: boolean;
  unreadCount: number;
  lastMessageTime: number;
  isNewContact?: boolean;
}
