/**
 * useDebounce Hook
 *
 * Provides debounced values and callbacks for performance optimization.
 * Use this to delay expensive operations like search until user stops typing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { isDev } from '../performance';

/**
 * Returns a debounced version of the value that only updates
 * after the specified delay has passed without changes.
 *
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced callback that will only execute
 * after the specified delay has passed since the last call.
 *
 * @param callback - The callback function to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const callbackRef = useRef(callback);

  // Update callback ref on each render to get latest closure
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);
}

/**
 * Combines debounced value with immediate value for better UX.
 * Returns both the immediate value (for display) and debounced value (for search).
 *
 * @param initialValue - Initial value
 * @param delay - Debounce delay in milliseconds
 */
export function useDebouncedState<T>(
  initialValue: T,
  delay: number = 300
): [T, T, (value: T) => void] {
  const [value, setValue] = useState<T>(initialValue);
  const debouncedValue = useDebounce(value, delay);

  if (isDev && value !== debouncedValue) {
    // Value is still being debounced
  }

  return [value, debouncedValue, setValue];
}

export default useDebounce;
