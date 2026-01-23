/**
 * Web Worker for background search operations
 * This keeps the main thread responsive during search
 */

interface Page {
  bookId: string;
  volume: number;
  page: number;
  text: string;
}

interface SearchResult {
  bookId: string;
  bookTitle: string;
  volume: number;
  page: number;
  snippet: string;
  matchIndex: number;
}

interface SearchMessage {
  type: 'search';
  query: string;
  mode: 'exact' | 'root';
  pages: Page[];
  books: { id: string; title: string }[];
}

interface SearchResponse {
  type: 'searchResults';
  results: SearchResult[];
  duration: number;
}

// Arabic normalization for root matching
const normalizeArabic = (text: string): string => {
  return text
    // Remove tashkeel (diacritics)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize alef variations
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize waw with hamza
    .replace(/ؤ/g, 'و')
    // Normalize yaa with hamza
    .replace(/ئ/g, 'ي')
    // Normalize taa marbouta
    .replace(/ة/g, 'ه')
    // Normalize alef maqsura
    .replace(/ى/g, 'ي')
    // Normalize tatweel
    .replace(/ـ/g, '');
};

// Extract snippet around match
const extractSnippet = (text: string, matchIndex: number, length = 100): string => {
  const start = Math.max(0, matchIndex - length / 2);
  const end = Math.min(text.length, matchIndex + length / 2);

  let snippet = text.substring(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
};

// Main search function
const performSearch = (
  query: string,
  mode: 'exact' | 'root',
  pages: Page[],
  books: { id: string; title: string }[]
): SearchResult[] => {
  const results: SearchResult[] = [];
  const bookMap = new Map(books.map(b => [b.id, b.title]));

  const normalizedQuery = mode === 'root' ? normalizeArabic(query) : query;

  for (const page of pages) {
    try {
      const textParts = JSON.parse(page.text);
      const fullText = Array.isArray(textParts) ? textParts.join(' ') : String(textParts);
      const searchText = mode === 'root' ? normalizeArabic(fullText) : fullText;

      const matchIndex = searchText.indexOf(normalizedQuery);

      if (matchIndex !== -1) {
        results.push({
          bookId: page.bookId,
          bookTitle: bookMap.get(page.bookId.replace('_en', '')) || 'Unknown',
          volume: page.volume,
          page: page.page,
          snippet: extractSnippet(fullText, matchIndex, 150),
          matchIndex,
        });
      }
    } catch {
      // Skip pages with invalid text
      continue;
    }
  }

  return results;
};

// Handle messages from main thread
self.onmessage = (event: MessageEvent<SearchMessage>) => {
  const { type, query, mode, pages, books } = event.data;

  if (type === 'search') {
    const startTime = performance.now();

    const results = performSearch(query, mode, pages, books);

    const duration = performance.now() - startTime;

    const response: SearchResponse = {
      type: 'searchResults',
      results,
      duration,
    };

    self.postMessage(response);
  }
};

export {};
