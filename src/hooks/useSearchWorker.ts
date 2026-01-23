/**
 * Search Worker Hook
 * Performs search operations in a Web Worker for better performance
 *
 * In development mode, this offloads search to a background thread,
 * keeping the UI responsive even with large datasets.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface Page {
  bookId: string;
  volume: number;
  page: number;
  text: string;
}

interface Book {
  id: string;
  title: string;
}

interface SearchResult {
  bookId: string;
  bookTitle: string;
  volume: number;
  page: number;
  snippet: string;
  matchIndex: number;
}

interface SearchCache {
  key: string;
  results: SearchResult[];
  timestamp: number;
}

const CACHE_SIZE = 50;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useSearchWorker(enabled = true) {
  const workerRef = useRef<Worker | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchDuration, setLastSearchDuration] = useState<number | null>(null);
  const cacheRef = useRef<Map<string, SearchCache>>(new Map());

  // Initialize worker
  useEffect(() => {
    if (!enabled) return;

    try {
      workerRef.current = new Worker(
        new URL('../workers/search.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (error) {
      console.warn('Web Worker not supported, falling back to main thread search:', error);
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, [enabled]);

  // Generate cache key
  const getCacheKey = useCallback((query: string, mode: 'exact' | 'root'): string => {
    return `${mode}:${query}`;
  }, []);

  // Check cache
  const getFromCache = useCallback((query: string, mode: 'exact' | 'root'): SearchResult[] | null => {
    const key = getCacheKey(query, mode);
    const cached = cacheRef.current.get(key);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.results;
    }

    return null;
  }, [getCacheKey]);

  // Add to cache with LRU eviction
  const addToCache = useCallback((query: string, mode: 'exact' | 'root', results: SearchResult[]) => {
    const key = getCacheKey(query, mode);

    // LRU eviction
    if (cacheRef.current.size >= CACHE_SIZE) {
      const oldestKey = cacheRef.current.keys().next().value;
      if (oldestKey) {
        cacheRef.current.delete(oldestKey);
      }
    }

    cacheRef.current.set(key, {
      key,
      results,
      timestamp: Date.now(),
    });
  }, [getCacheKey]);

  // Clear cache
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  // Perform search with worker
  const search = useCallback(async (
    query: string,
    mode: 'exact' | 'root',
    pages: Page[],
    books: Book[]
  ): Promise<SearchResult[]> => {
    // Check cache first
    const cached = getFromCache(query, mode);
    if (cached) {
      console.log('[SearchWorker] Cache hit for:', query);
      return cached;
    }

    setIsSearching(true);

    try {
      let results: SearchResult[];

      if (workerRef.current && enabled) {
        // Use Web Worker
        results = await new Promise((resolve) => {
          const worker = workerRef.current!;

          const handler = (event: MessageEvent) => {
            if (event.data.type === 'searchResults') {
              setLastSearchDuration(event.data.duration);
              worker.removeEventListener('message', handler);
              resolve(event.data.results);
            }
          };

          worker.addEventListener('message', handler);
          worker.postMessage({
            type: 'search',
            query,
            mode,
            pages,
            books,
          });
        });
      } else {
        // Fallback: main thread search
        const startTime = performance.now();
        results = performSearchMainThread(query, mode, pages, books);
        setLastSearchDuration(performance.now() - startTime);
      }

      // Cache results
      addToCache(query, mode, results);

      return results;
    } finally {
      setIsSearching(false);
    }
  }, [enabled, getFromCache, addToCache]);

  return {
    search,
    isSearching,
    lastSearchDuration,
    clearCache,
    isWorkerEnabled: enabled && !!workerRef.current,
  };
}

// Fallback main thread search (same logic as worker)
function performSearchMainThread(
  query: string,
  mode: 'exact' | 'root',
  pages: Page[],
  books: Book[]
): SearchResult[] {
  const results: SearchResult[] = [];
  const bookMap = new Map(books.map(b => [b.id, b.title]));

  const normalizeArabic = (text: string): string => {
    return text
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ـ/g, '');
  };

  const normalizedQuery = mode === 'root' ? normalizeArabic(query) : query;

  for (const page of pages) {
    try {
      const textParts = JSON.parse(page.text);
      const fullText = Array.isArray(textParts) ? textParts.join(' ') : String(textParts);
      const searchText = mode === 'root' ? normalizeArabic(fullText) : fullText;

      const matchIndex = searchText.indexOf(normalizedQuery);

      if (matchIndex !== -1) {
        const start = Math.max(0, matchIndex - 75);
        const end = Math.min(fullText.length, matchIndex + 75);
        let snippet = fullText.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < fullText.length) snippet = snippet + '...';

        results.push({
          bookId: page.bookId,
          bookTitle: bookMap.get(page.bookId.replace('_en', '')) || 'Unknown',
          volume: page.volume,
          page: page.page,
          snippet,
          matchIndex,
        });
      }
    } catch {
      continue;
    }
  }

  return results;
}
