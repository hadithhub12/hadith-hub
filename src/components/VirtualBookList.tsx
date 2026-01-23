/**
 * Virtual Book List Component
 *
 * This component provides efficient rendering for large book lists
 * using virtualization. It only renders visible items, dramatically
 * improving performance for large datasets.
 *
 * Usage:
 * <VirtualBookList
 *   books={books}
 *   onBookClick={handleBookClick}
 *   renderBook={(book) => <BookCard book={book} />}
 *   itemHeight={80}
 * />
 */

import { useRef, type ReactNode, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface Book {
  id: string;
  title: string;
  author?: string;
  volumes: number;
}

interface VirtualBookListProps<T extends Book> {
  books: T[];
  onBookClick?: (book: T) => void;
  renderBook: (book: T, index: number) => ReactNode;
  itemHeight?: number;
  containerHeight?: number | string;
  containerStyle?: CSSProperties;
  overscan?: number;
  enabled?: boolean;
}

export function VirtualBookList<T extends Book>({
  books,
  onBookClick,
  renderBook,
  itemHeight = 80,
  containerHeight = '100%',
  containerStyle,
  overscan = 5,
  enabled = true,
}: VirtualBookListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: books.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan,
  });

  // If not enabled or list is small, render normally
  if (!enabled || books.length < 50) {
    return (
      <div style={containerStyle}>
        {books.map((book, index) => (
          <div
            key={book.id}
            onClick={() => onBookClick?.(book)}
            style={{ cursor: onBookClick ? 'pointer' : 'default' }}
          >
            {renderBook(book, index)}
          </div>
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      style={{
        height: containerHeight,
        overflow: 'auto',
        ...containerStyle,
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const book = books[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              onClick={() => onBookClick?.(book)}
            >
              {renderBook(book, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Virtual Search Results List
 *
 * Optimized for search result rendering with snippet display
 */
interface SearchResult {
  bookId: string;
  bookTitle: string;
  volume: number;
  page: number;
  snippet: string;
  matchIndex: number;
}

interface VirtualSearchResultsProps {
  results: SearchResult[];
  onResultClick?: (result: SearchResult) => void;
  renderResult: (result: SearchResult, index: number) => ReactNode;
  itemHeight?: number;
  containerHeight?: number | string;
  containerStyle?: CSSProperties;
  enabled?: boolean;
}

export function VirtualSearchResults({
  results,
  onResultClick,
  renderResult,
  itemHeight = 120,
  containerHeight = '100%',
  containerStyle,
  enabled = true,
}: VirtualSearchResultsProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 3,
  });

  // If not enabled or list is small, render normally
  if (!enabled || results.length < 30) {
    return (
      <div style={containerStyle}>
        {results.map((result, index) => (
          <div
            key={`${result.bookId}-${result.volume}-${result.page}-${result.matchIndex}`}
            onClick={() => onResultClick?.(result)}
            style={{ cursor: onResultClick ? 'pointer' : 'default' }}
          >
            {renderResult(result, index)}
          </div>
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      style={{
        height: containerHeight,
        overflow: 'auto',
        ...containerStyle,
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const result = results[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              onClick={() => onResultClick?.(result)}
            >
              {renderResult(result, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualBookList;
