import { Injectable, signal, computed } from '@angular/core';
import { ChatFilters } from './whatsapp.service';

@Injectable({
  providedIn: 'root'
})
export class FilterService {
  private filtersSignal = signal<ChatFilters>({
    chatType: 'all',
    readStatus: 'all',
    dateRange: 'all',
    replyStatus: 'all',
    contactType: 'all',
    search: ''
  });

  readonly filters = this.filtersSignal.asReadonly();

  readonly activeFiltersCount = computed(() => {
    const f = this.filtersSignal();
    let count = 0;
    if (f.chatType !== 'all') count++;
    if (f.readStatus !== 'all') count++;
    if (f.dateRange !== 'all') count++;
    if (f.replyStatus !== 'all') count++;
    if (f.contactType !== 'all') count++;
    if (f.search) count++;
    return count;
  });

  readonly hasActiveFilters = computed(() => this.activeFiltersCount() > 0);

  updateFilter<K extends keyof ChatFilters>(key: K, value: ChatFilters[K]): void {
    this.filtersSignal.update(filters => ({
      ...filters,
      [key]: value
    }));
  }

  updateFilters(updates: Partial<ChatFilters>): void {
    this.filtersSignal.update(filters => ({
      ...filters,
      ...updates
    }));
  }

  resetFilters(): void {
    this.filtersSignal.set({
      chatType: 'all',
      readStatus: 'all',
      dateRange: 'all',
      replyStatus: 'all',
      contactType: 'all',
      search: ''
    });
  }

  resetFilter<K extends keyof ChatFilters>(key: K): void {
    const defaultValues: ChatFilters = {
      chatType: 'all',
      readStatus: 'all',
      dateRange: 'all',
      replyStatus: 'all',
      contactType: 'all',
      search: ''
    };

    this.filtersSignal.update(filters => ({
      ...filters,
      [key]: defaultValues[key]
    }));
  }
}
