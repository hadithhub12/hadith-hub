# Performance Optimization Guide for Hadith Hub

This document outlines performance optimization strategies for the Hadith Hub application, covering both application performance and search performance.

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Application Performance Optimizations](#application-performance-optimizations)
3. [Search Performance Optimizations](#search-performance-optimizations)
4. [IndexedDB Optimizations](#indexeddb-optimizations)
5. [Network & Loading Optimizations](#network--loading-optimizations)
6. [React-Specific Optimizations](#react-specific-optimizations)
7. [Mobile Performance](#mobile-performance)
8. [Monitoring & Metrics](#monitoring--metrics)

---

## Current Architecture Analysis

### Application Structure
- **Single-file App.tsx** (~6,700 lines) containing all components
- **IndexedDB** for local storage (books, volumes, pages)
- **LocalStorage** for preferences (theme, language, font, reading mode)
- **In-memory caching** of database contents
- **PWA** with service worker for offline support

### Identified Bottlenecks
1. Large single component file (difficult code splitting)
2. Full data loaded into memory on startup
3. Sequential page loading from IndexedDB
4. No virtual scrolling for large lists
5. Search performs full-text scan of all pages

---

## Application Performance Optimizations

### 1. Code Splitting (High Impact)

**Current State:** All code in single App.tsx file

**Recommendation:** Split into separate components

```typescript
// Recommended structure
src/
├── components/
│   ├── Home/
│   │   ├── BookCard.tsx
│   │   ├── BookGrid.tsx
│   │   └── Pagination.tsx
│   ├── Reader/
│   │   ├── PageContent.tsx
│   │   ├── PageNavigation.tsx
│   │   └── ReadingModes.tsx
│   ├── Import/
│   │   ├── BookList.tsx
│   │   ├── VolumeSelector.tsx
│   │   └── DownloadProgress.tsx
│   ├── Search/
│   │   ├── SearchForm.tsx
│   │   ├── SearchResults.tsx
│   │   └── ResultItem.tsx
│   └── Settings/
│       ├── LanguageSelector.tsx
│       ├── ThemeSelector.tsx
│       └── FontSelector.tsx
├── hooks/
│   ├── useDatabase.ts
│   ├── useResponsive.ts
│   └── useSearch.ts
├── services/
│   ├── database.ts
│   ├── search.ts
│   └── download.ts
└── utils/
    ├── arabic.ts
    └── transliteration.ts
```

**Lazy Loading:**
```typescript
const Reader = React.lazy(() => import('./components/Reader'));
const Import = React.lazy(() => import('./components/Import'));
const Settings = React.lazy(() => import('./components/Settings'));

// In render
<Suspense fallback={<LoadingSpinner />}>
  {view === 'reader' && <Reader {...props} />}
</Suspense>
```

### 2. Virtual Scrolling (High Impact)

**Problem:** Large book lists and search results cause performance issues

**Solution:** Implement virtualized lists

```typescript
// Using @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

function BookList({ books }) {
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: books.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // estimated row height
    overscan: 5,
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <BookCard book={books[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 3. Memoization (Medium Impact)

**Use React.memo for expensive components:**
```typescript
const BookCard = React.memo(({ book, onClick }) => {
  return (
    <div onClick={() => onClick(book.id)}>
      <h3>{book.title}</h3>
      <p>{book.author}</p>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.book.id === nextProps.book.id;
});
```

**Use useMemo for expensive calculations:**
```typescript
const filteredBooks = useMemo(() => {
  return books.filter(book => {
    const matchesSect = sectFilter === 'all' || getBookSect(book.id) === sectFilter;
    const matchesLang = langFilter === 'all' || book.language === langFilter;
    const matchesSearch = !searchQuery ||
      book.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSect && matchesLang && matchesSearch;
  });
}, [books, sectFilter, langFilter, searchQuery]);
```

**Use useCallback for event handlers:**
```typescript
const handleBookClick = useCallback((bookId: string) => {
  setSelectedBook(bookId);
  setView('library');
}, []);
```

---

## Search Performance Optimizations

### 1. Search Index (High Impact)

**Current State:** Linear scan through all pages

**Solution:** Create inverted index for search terms

```typescript
interface SearchIndex {
  terms: Map<string, Set<PageReference>>;
  normalizedTerms: Map<string, Set<PageReference>>;
}

interface PageReference {
  bookId: string;
  volume: number;
  page: number;
  offset: number;
}

// Build index when importing books
async function buildSearchIndex(pages: Page[]): Promise<SearchIndex> {
  const index: SearchIndex = {
    terms: new Map(),
    normalizedTerms: new Map(),
  };

  for (const page of pages) {
    const text = JSON.parse(page.text).join(' ');
    const words = text.split(/\s+/);

    words.forEach((word, offset) => {
      // Exact term
      if (!index.terms.has(word)) {
        index.terms.set(word, new Set());
      }
      index.terms.get(word)!.add({
        bookId: page.bookId,
        volume: page.volume,
        page: page.page,
        offset
      });

      // Normalized term (for root matching)
      const normalized = normalizeArabic(word);
      if (!index.normalizedTerms.has(normalized)) {
        index.normalizedTerms.set(normalized, new Set());
      }
      index.normalizedTerms.get(normalized)!.add({
        bookId: page.bookId,
        volume: page.volume,
        page: page.page,
        offset
      });
    });
  }

  return index;
}
```

### 2. Web Worker for Search (High Impact)

**Move search to background thread:**

```typescript
// search.worker.ts
self.onmessage = async (e) => {
  const { query, mode, pages } = e.data;

  const results: SearchResult[] = [];
  const searchFn = mode === 'root' ? normalizeArabic : (x: string) => x;
  const normalizedQuery = searchFn(query);

  for (const page of pages) {
    const text = JSON.parse(page.text).join(' ');
    const normalizedText = searchFn(text);

    if (normalizedText.includes(normalizedQuery)) {
      const matchIndex = normalizedText.indexOf(normalizedQuery);
      results.push({
        bookId: page.bookId,
        volume: page.volume,
        page: page.page,
        snippet: extractSnippet(text, matchIndex, 100),
        matchIndex,
      });
    }
  }

  self.postMessage({ results });
};

// In React component
const searchWorker = new Worker(new URL('./search.worker.ts', import.meta.url));

async function performSearch(query: string): Promise<SearchResult[]> {
  return new Promise((resolve) => {
    searchWorker.postMessage({ query, mode: searchMode, pages: pagesStore });
    searchWorker.onmessage = (e) => resolve(e.data.results);
  });
}
```

### 3. Debounced Search (Medium Impact)

```typescript
import { useDeferredValue, useTransition } from 'react';

function SearchComponent() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [isPending, startTransition] = useTransition();

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    startTransition(() => {
      performSearch(value);
    });
  }, []);

  return (
    <>
      <input onChange={(e) => handleSearch(e.target.value)} />
      {isPending && <span>Searching...</span>}
    </>
  );
}
```

### 4. Search Result Caching

```typescript
const searchCache = new Map<string, SearchResult[]>();
const CACHE_SIZE = 100;

function getCachedSearch(query: string, mode: SearchMode): SearchResult[] | null {
  const key = `${mode}:${query}`;
  return searchCache.get(key) || null;
}

function cacheSearchResults(query: string, mode: SearchMode, results: SearchResult[]) {
  const key = `${mode}:${query}`;

  // LRU eviction
  if (searchCache.size >= CACHE_SIZE) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }

  searchCache.set(key, results);
}
```

---

## IndexedDB Optimizations

### 1. Batch Operations (High Impact)

**Current Issue:** Single transactions for each insert

**Solution:** Batch writes

```typescript
async function savePagesBatch(pages: Page[], batchSize = 100): Promise<void> {
  const database = await initDB();

  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);

    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('pages', 'readwrite');
      const store = tx.objectStore('pages');

      batch.forEach(page => store.put(page));

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
```

### 2. Cursor-based Reading (Medium Impact)

**For large datasets, use cursors instead of getAll:**

```typescript
async function* iteratePages(bookId: string, volume: number): AsyncGenerator<Page> {
  const database = await initDB();
  const tx = database.transaction('pages', 'readonly');
  const store = tx.objectStore('pages');
  const index = store.index('bookVolume');

  const request = index.openCursor(IDBKeyRange.only([bookId, volume]));

  while (true) {
    const cursor = await new Promise<IDBCursorWithValue | null>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });

    if (!cursor) break;

    yield cursor.value as Page;
    cursor.continue();
  }
}

// Usage
for await (const page of iteratePages('book-123', 1)) {
  processPage(page);
}
```

### 3. Lazy Loading Pages (High Impact)

**Only load visible pages:**

```typescript
async function getPage(bookId: string, volume: number, pageNum: number): Promise<Page | null> {
  // Check memory cache first
  const cacheKey = `${bookId}-${volume}-${pageNum}`;
  if (pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey)!;
  }

  // Load from IndexedDB
  const database = await initDB();
  const page = await new Promise<Page | null>((resolve) => {
    const tx = database.transaction('pages', 'readonly');
    const store = tx.objectStore('pages');
    const request = store.get([bookId, volume, pageNum]);
    request.onsuccess = () => resolve(request.result || null);
  });

  // Cache in memory (with LRU eviction)
  if (page) {
    pageCache.set(cacheKey, page);
    evictOldestIfNeeded();
  }

  return page;
}
```

---

## Network & Loading Optimizations

### 1. Parallel Downloads (High Impact)

**Current:** Sequential volume downloads

**Solution:** Download volumes in parallel with concurrency limit

```typescript
async function downloadVolumesParallel(
  volumes: AvailableDownload[],
  concurrency = 3,
  onProgress: (completed: number, total: number) => void
): Promise<void> {
  let completed = 0;
  const total = volumes.length;

  async function downloadOne(volume: AvailableDownload) {
    await downloadVolume(volume);
    completed++;
    onProgress(completed, total);
  }

  const queue = [...volumes];
  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const volume = queue.shift();
        if (volume) await downloadOne(volume);
      }
    });

  await Promise.all(workers);
}
```

### 2. Progressive Loading

**Show content as it loads:**

```typescript
function ReaderView({ bookId, volume }: Props) {
  const [pages, setPages] = useState<Page[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPages() {
      setIsLoading(true);

      // Load first page immediately
      const firstPage = await getPage(bookId, volume, 1);
      if (firstPage) {
        setPages([firstPage]);
      }

      // Load remaining pages in background
      const allPages = await getAllPages(bookId, volume);
      setPages(allPages);
      setIsLoading(false);
    }

    loadPages();
  }, [bookId, volume]);

  return (
    <>
      {pages.length > 0 && <PageContent page={pages[currentPage - 1]} />}
      {isLoading && <LoadingIndicator />}
    </>
  );
}
```

### 3. Preloading Adjacent Pages

```typescript
function usePreloadPages(bookId: string, volume: number, currentPage: number) {
  useEffect(() => {
    // Preload next 2 and previous 2 pages
    const pagesToPreload = [
      currentPage - 2,
      currentPage - 1,
      currentPage + 1,
      currentPage + 2,
    ].filter(p => p > 0);

    pagesToPreload.forEach(pageNum => {
      getPage(bookId, volume, pageNum); // Populates cache
    });
  }, [bookId, volume, currentPage]);
}
```

---

## React-Specific Optimizations

### 1. State Management

**Move to useReducer for complex state:**

```typescript
type AppState = {
  view: ViewType;
  books: Book[];
  currentBook: string | null;
  currentVolume: number;
  currentPage: number;
  theme: Theme;
  language: Language;
  // ... other state
};

type AppAction =
  | { type: 'SET_VIEW'; payload: ViewType }
  | { type: 'SET_BOOKS'; payload: Book[] }
  | { type: 'NAVIGATE_TO_BOOK'; payload: { bookId: string; volume?: number; page?: number } }
  | { type: 'SET_THEME'; payload: Theme }
  // ... other actions

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.payload };
    case 'NAVIGATE_TO_BOOK':
      return {
        ...state,
        currentBook: action.payload.bookId,
        currentVolume: action.payload.volume ?? 1,
        currentPage: action.payload.page ?? 1,
        view: 'library',
      };
    // ... handle other actions
    default:
      return state;
  }
}
```

### 2. Avoid Inline Styles

**Current:** Extensive inline styles object

**Solution:** Use CSS modules or styled-components

```typescript
// styles.module.css
.bookCard {
  background: var(--card);
  border-radius: var(--radius);
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bookCard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

// Component
import styles from './styles.module.css';

function BookCard({ book }) {
  return <div className={styles.bookCard}>{book.title}</div>;
}
```

### 3. Suspense for Data Loading

```typescript
import { Suspense } from 'react';
import { use } from 'react';

// Create a resource
function createResource<T>(promise: Promise<T>) {
  let status = 'pending';
  let result: T;
  let error: Error;

  const suspender = promise.then(
    (r) => { status = 'success'; result = r; },
    (e) => { status = 'error'; error = e; }
  );

  return {
    read() {
      if (status === 'pending') throw suspender;
      if (status === 'error') throw error;
      return result;
    }
  };
}

// Usage
const booksResource = createResource(loadBooks());

function BookList() {
  const books = booksResource.read();
  return <>{books.map(book => <BookCard key={book.id} book={book} />)}</>;
}

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <BookList />
    </Suspense>
  );
}
```

---

## Mobile Performance

### 1. Touch Optimization

```typescript
// Use passive event listeners
useEffect(() => {
  const options = { passive: true };

  element.addEventListener('touchstart', handleTouchStart, options);
  element.addEventListener('touchmove', handleTouchMove, options);

  return () => {
    element.removeEventListener('touchstart', handleTouchStart);
    element.removeEventListener('touchmove', handleTouchMove);
  };
}, []);
```

### 2. Reduce Layout Thrashing

```typescript
// Bad: Multiple reads/writes
element.style.width = '100px';
const height = element.offsetHeight; // Forces layout
element.style.height = height + 'px';

// Good: Batch reads, then batch writes
const height = element.offsetHeight;
requestAnimationFrame(() => {
  element.style.width = '100px';
  element.style.height = height + 'px';
});
```

### 3. CSS containment

```css
.bookCard {
  contain: content; /* Isolates the element's painting and layout */
}

.pageContent {
  contain: strict; /* Maximum isolation */
}
```

---

## Monitoring & Metrics

### 1. Performance Tracking

```typescript
// Track key metrics
const metrics = {
  appLoadTime: 0,
  databaseLoadTime: 0,
  searchTime: 0,
  pageRenderTime: 0,
};

// Measure database load
const dbStart = performance.now();
await loadFromDB();
metrics.databaseLoadTime = performance.now() - dbStart;

// Measure search
const searchStart = performance.now();
const results = await performSearch(query);
metrics.searchTime = performance.now() - searchStart;

// Log metrics
console.log('Performance Metrics:', metrics);
```

### 2. React DevTools Profiler

Enable profiling in development:

```typescript
// In development, wrap app with Profiler
import { Profiler } from 'react';

function onRenderCallback(
  id: string,
  phase: string,
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
) {
  console.log(`${id} ${phase}: ${actualDuration.toFixed(2)}ms`);
}

<Profiler id="App" onRender={onRenderCallback}>
  <App />
</Profiler>
```

### 3. Web Vitals

```typescript
import { getCLS, getFID, getLCP, getFCP, getTTFB } from 'web-vitals';

function sendToAnalytics(metric) {
  console.log(metric.name, metric.value);
}

getCLS(sendToAnalytics);
getFID(sendToAnalytics);
getLCP(sendToAnalytics);
getFCP(sendToAnalytics);
getTTFB(sendToAnalytics);
```

---

## Implementation Priority

### High Priority (Immediate Impact)
1. **Virtual scrolling** - Critical for large book/search lists
2. **Web Worker for search** - Keeps UI responsive
3. **Lazy loading pages** - Reduces memory usage
4. **Parallel downloads** - Faster book imports

### Medium Priority (Significant Improvement)
5. Code splitting and lazy loading components
6. Search indexing
7. Memoization (React.memo, useMemo, useCallback)
8. Batch IndexedDB operations

### Low Priority (Refinement)
9. CSS optimization (modules, containment)
10. Performance monitoring
11. Preloading adjacent pages
12. Touch optimization for mobile

---

## Quick Wins

These can be implemented immediately with minimal effort:

1. **Add `loading="lazy"` to images**
2. **Use `font-display: swap`** in font imports
3. **Add `will-change: transform`** to animated elements
4. **Use `requestAnimationFrame`** for scroll handlers
5. **Debounce search input** (300ms delay)

---

## Testing Performance

Run Lighthouse audit:
```bash
npx lighthouse http://localhost:5173 --view
```

Run Playwright with timing:
```bash
npx playwright test --reporter=json > results.json
```

Profile with Chrome DevTools:
1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record
4. Perform actions
5. Stop recording
6. Analyze flame chart

---

*Last updated: January 2026*
