/**
 * Virtual List Hook
 * Provides efficient rendering for large lists using @tanstack/react-virtual
 *
 * Usage in dev mode only - wrap list components with this for performance testing
 */

import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface UseVirtualListOptions<T> {
  items: T[];
  estimateSize: number;
  overscan?: number;
  enabled?: boolean;
}

export function useVirtualList<T>({
  items,
  estimateSize,
  overscan = 5,
  enabled = true,
}: UseVirtualListOptions<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: enabled ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  const virtualItems = enabled ? virtualizer.getVirtualItems() : [];
  const totalSize = enabled ? virtualizer.getTotalSize() : items.length * estimateSize;

  // Get the actual items for virtual rendering
  const getVirtualizedItems = useCallback(() => {
    if (!enabled) {
      return items.map((item, index) => ({
        item,
        index,
        style: {},
        isVirtual: false,
      }));
    }

    return virtualItems.map((virtualItem) => ({
      item: items[virtualItem.index],
      index: virtualItem.index,
      style: {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${virtualItem.start}px)`,
      },
      isVirtual: true,
      key: virtualItem.key,
    }));
  }, [items, virtualItems, enabled]);

  return {
    parentRef,
    virtualizer,
    virtualItems,
    totalSize,
    getVirtualizedItems,
    isEnabled: enabled,
  };
}

/**
 * Check if virtual scrolling should be enabled based on list size
 */
export function shouldUseVirtualScrolling(itemCount: number, threshold = 50): boolean {
  return itemCount > threshold;
}
