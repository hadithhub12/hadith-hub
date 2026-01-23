/**
 * Performance Optimizations Module
 *
 * This module provides performance utilities that are enabled in development mode.
 * It includes:
 * - Search result caching with LRU eviction
 * - Performance metrics tracking
 * - Utility functions for optimization
 */

// Check if we're in development mode
export const isDev = import.meta.env.DEV;

// Search result cache
interface CachedSearch {
  results: unknown[];
  timestamp: number;
}

const searchCache = new Map<string, CachedSearch>();
const CACHE_SIZE = 50;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached search results
 */
export function getCachedSearchResults<T>(cacheKey: string): T[] | null {
  const cached = searchCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    if (isDev) {
      console.log(`[Performance] Search cache hit: ${cacheKey}`);
    }
    return cached.results as T[];
  }

  // Remove stale entry
  if (cached) {
    searchCache.delete(cacheKey);
  }

  return null;
}

/**
 * Cache search results with LRU eviction
 */
export function cacheSearchResults<T>(cacheKey: string, results: T[]): void {
  // LRU eviction
  if (searchCache.size >= CACHE_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) {
      searchCache.delete(oldestKey);
      if (isDev) {
        console.log(`[Performance] Cache evicted: ${oldestKey}`);
      }
    }
  }

  searchCache.set(cacheKey, {
    results,
    timestamp: Date.now(),
  });

  if (isDev) {
    console.log(`[Performance] Search cached: ${cacheKey} (${results.length} results)`);
  }
}

/**
 * Clear all cached search results
 */
export function clearSearchCache(): void {
  searchCache.clear();
  if (isDev) {
    console.log('[Performance] Search cache cleared');
  }
}

/**
 * Generate cache key for search
 */
export function getSearchCacheKey(
  query: string,
  mode: 'exact' | 'root',
  sectFilter: string,
  selectedBooks: Set<string>
): string {
  const booksKey = selectedBooks.size > 0 ? Array.from(selectedBooks).sort().join(',') : 'all';
  return `${mode}:${sectFilter}:${booksKey}:${query}`;
}

// Performance metrics tracking
interface PerformanceMetrics {
  searchDuration: number[];
  renderDuration: number[];
  dbLoadDuration: number[];
}

const metrics: PerformanceMetrics = {
  searchDuration: [],
  renderDuration: [],
  dbLoadDuration: [],
};

/**
 * Track performance metric
 */
export function trackMetric(type: keyof PerformanceMetrics, duration: number): void {
  metrics[type].push(duration);

  // Keep only last 100 measurements
  if (metrics[type].length > 100) {
    metrics[type].shift();
  }

  if (isDev) {
    const avg = metrics[type].reduce((a, b) => a + b, 0) / metrics[type].length;
    console.log(`[Performance] ${type}: ${duration.toFixed(2)}ms (avg: ${avg.toFixed(2)}ms)`);
  }
}

/**
 * Get performance summary
 */
export function getPerformanceSummary(): Record<string, { avg: number; min: number; max: number; count: number }> {
  const summary: Record<string, { avg: number; min: number; max: number; count: number }> = {};

  for (const [key, values] of Object.entries(metrics)) {
    if (values.length > 0) {
      summary[key] = {
        avg: values.reduce((a: number, b: number) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    }
  }

  return summary;
}

/**
 * Measure async operation
 */
export async function measureAsync<T>(
  operation: () => Promise<T>,
  metricType: keyof PerformanceMetrics
): Promise<T> {
  const start = performance.now();
  try {
    return await operation();
  } finally {
    trackMetric(metricType, performance.now() - start);
  }
}

/**
 * Debounce function for search input
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Check if virtual scrolling should be enabled
 */
export function shouldUseVirtualScrolling(itemCount: number): boolean {
  // Enable virtual scrolling for lists with more than 50 items
  return isDev && itemCount > 50;
}

/**
 * Log performance info in development
 */
export function logPerformanceInfo(label: string, data?: Record<string, unknown>): void {
  if (isDev) {
    console.log(`[Performance] ${label}`, data || '');
  }
}

/**
 * Download items in parallel with concurrency limit
 * Returns results in the same order as input
 */
export async function downloadParallel<T, R>(
  items: T[],
  downloadFn: (item: T, index: number) => Promise<R>,
  concurrency: number = 3,
  onProgress?: (completed: number, total: number) => void
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let completed = 0;
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        results[index] = await downloadFn(items[index], index);
      } catch (error) {
        if (isDev) {
          console.error(`[Performance] Download failed for item ${index}:`, error);
        }
        results[index] = null;
      }
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);

  if (isDev) {
    const successCount = results.filter(r => r !== null).length;
    logPerformanceInfo('Parallel download complete', {
      total: items.length,
      successful: successCount,
      failed: items.length - successCount,
      concurrency,
    });
  }

  return results;
}
