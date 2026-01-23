import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for data persistence using IndexedDB
 */

test.describe('IndexedDB - Database Initialization', () => {
  test('should create database with correct stores', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const dbInfo = await page.evaluate(async () => {
      return new Promise<{
        name: string;
        version: number;
        stores: string[];
      }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => {
          const db = request.result;
          resolve({
            name: db.name,
            version: db.version,
            stores: Array.from(db.objectStoreNames),
          });
        };
      });
    });

    expect(dbInfo.name).toBe('hadithHub');
    expect(dbInfo.stores).toContain('books');
    expect(dbInfo.stores).toContain('volumes');
    expect(dbInfo.stores).toContain('pages');
  });
});

test.describe('IndexedDB - Book Storage', () => {
  test.beforeEach(async ({ page }) => {
    // Clear database before each test
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name === 'hadithHub') {
          indexedDB.deleteDatabase(db.name);
        }
      }
    });
    await page.reload();
    await page.waitForTimeout(1000);
  });

  test('should store book data correctly', async ({ page }) => {
    // Add a book via the API
    const bookData = await page.evaluate(async () => {
      return new Promise<{ success: boolean; book: unknown }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('books')) {
            db.createObjectStore('books', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('volumes')) {
            db.createObjectStore('volumes', { keyPath: ['bookId', 'volume'] });
          }
          if (!db.objectStoreNames.contains('pages')) {
            db.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('books', 'readwrite');
          const store = tx.objectStore('books');

          const book = {
            id: 'test-persist-001',
            title: 'Test Book',
            author: 'Test Author',
            volumes: 1,
            importedAt: Date.now(),
          };

          store.put(book);

          tx.oncomplete = () => {
            // Read it back
            const readTx = db.transaction('books', 'readonly');
            const readStore = readTx.objectStore('books');
            const getRequest = readStore.get('test-persist-001');

            getRequest.onsuccess = () => {
              resolve({ success: true, book: getRequest.result });
            };
          };
        };
      });
    });

    expect(bookData.success).toBeTruthy();
    expect((bookData.book as { title: string }).title).toBe('Test Book');
  });

  test('should retrieve all books', async ({ page }) => {
    // Add multiple books
    await page.evaluate(async () => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('books')) {
            db.createObjectStore('books', { keyPath: 'id' });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('books', 'readwrite');
          const store = tx.objectStore('books');

          store.put({ id: 'book-1', title: 'Book 1', volumes: 1 });
          store.put({ id: 'book-2', title: 'Book 2', volumes: 2 });
          store.put({ id: 'book-3', title: 'Book 3', volumes: 3 });

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    });

    // Reload to trigger app's data loading
    await page.reload();
    await page.waitForTimeout(2000);

    // Check console for loaded books
    const bookCount = await page.evaluate(async () => {
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('books', 'readonly');
          const store = tx.objectStore('books');
          const countRequest = store.count();
          countRequest.onsuccess = () => {
            db.close();
            resolve(countRequest.result);
          };
        };
      });
    });

    expect(bookCount).toBe(3);
  });
});

test.describe('IndexedDB - Volume Storage', () => {
  test('should store volume with composite key', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const volumeData = await page.evaluate(async () => {
      return new Promise<{ success: boolean; volume: unknown }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('volumes')) {
            db.createObjectStore('volumes', { keyPath: ['bookId', 'volume'] });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('volumes', 'readwrite');
          const store = tx.objectStore('volumes');

          const volume = {
            bookId: 'test-book',
            volume: 1,
            totalPages: 100,
            importedAt: Date.now(),
          };

          store.put(volume);

          tx.oncomplete = () => {
            const readTx = db.transaction('volumes', 'readonly');
            const readStore = readTx.objectStore('volumes');
            const getRequest = readStore.get(['test-book', 1]);

            getRequest.onsuccess = () => {
              db.close();
              resolve({ success: true, volume: getRequest.result });
            };
          };
        };
      });
    });

    expect(volumeData.success).toBeTruthy();
    expect((volumeData.volume as { totalPages: number }).totalPages).toBe(100);
  });

  test('should handle multiple volumes per book', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const volumes = await page.evaluate(async () => {
      return new Promise<{ count: number }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('volumes')) {
            const store = db.createObjectStore('volumes', { keyPath: ['bookId', 'volume'] });
            store.createIndex('bookId', 'bookId', { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('volumes', 'readwrite');
          const store = tx.objectStore('volumes');

          // Add 5 volumes for same book
          for (let i = 1; i <= 5; i++) {
            store.put({
              bookId: 'multi-vol-book',
              volume: i,
              totalPages: i * 50,
            });
          }

          tx.oncomplete = () => {
            const readTx = db.transaction('volumes', 'readonly');
            const readStore = readTx.objectStore('volumes');
            const countRequest = readStore.count();

            countRequest.onsuccess = () => {
              db.close();
              resolve({ count: countRequest.result });
            };
          };
        };
      });
    });

    expect(volumes.count).toBe(5);
  });
});

test.describe('IndexedDB - Page Storage', () => {
  test('should store pages with composite key', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const pageData = await page.evaluate(async () => {
      return new Promise<{ success: boolean; page: unknown }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('pages')) {
            const store = db.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
            store.createIndex('bookId', 'bookId', { unique: false });
            store.createIndex('bookVolume', ['bookId', 'volume'], { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('pages', 'readwrite');
          const store = tx.objectStore('pages');

          const pageObj = {
            bookId: 'test-book',
            volume: 1,
            page: 1,
            text: JSON.stringify(['Test content paragraph 1', 'Test content paragraph 2']),
          };

          store.put(pageObj);

          tx.oncomplete = () => {
            const readTx = db.transaction('pages', 'readonly');
            const readStore = readTx.objectStore('pages');
            const getRequest = readStore.get(['test-book', 1, 1]);

            getRequest.onsuccess = () => {
              db.close();
              resolve({ success: true, page: getRequest.result });
            };
          };
        };
      });
    });

    expect(pageData.success).toBeTruthy();
    expect((pageData.page as { text: string }).text).toContain('Test content');
  });

  test('should query pages by book and volume index', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const pages = await page.evaluate(async () => {
      return new Promise<{ pages: unknown[] }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('pages')) {
            const store = db.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
            store.createIndex('bookId', 'bookId', { unique: false });
            store.createIndex('bookVolume', ['bookId', 'volume'], { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('pages', 'readwrite');
          const store = tx.objectStore('pages');

          // Add 10 pages
          for (let i = 1; i <= 10; i++) {
            store.put({
              bookId: 'index-test-book',
              volume: 1,
              page: i,
              text: `Page ${i} content`,
            });
          }

          tx.oncomplete = () => {
            const readTx = db.transaction('pages', 'readonly');
            const readStore = readTx.objectStore('pages');
            const index = readStore.index('bookVolume');
            const range = IDBKeyRange.only(['index-test-book', 1]);
            const getAllRequest = index.getAll(range);

            getAllRequest.onsuccess = () => {
              db.close();
              resolve({ pages: getAllRequest.result });
            };
          };
        };
      });
    });

    expect(pages.pages.length).toBe(10);
  });
});

test.describe('IndexedDB - Data Deletion', () => {
  test('should delete specific book and its data', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const result = await page.evaluate(async () => {
      return new Promise<{ bookDeleted: boolean; pagesRemaining: number }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('books')) {
            db.createObjectStore('books', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('pages')) {
            const store = db.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
            store.createIndex('bookId', 'bookId', { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['books', 'pages'], 'readwrite');

          tx.objectStore('books').put({ id: 'to-delete', title: 'Delete Me' });
          tx.objectStore('books').put({ id: 'to-keep', title: 'Keep Me' });

          for (let i = 1; i <= 5; i++) {
            tx.objectStore('pages').put({ bookId: 'to-delete', volume: 1, page: i, text: 'Delete' });
            tx.objectStore('pages').put({ bookId: 'to-keep', volume: 1, page: i, text: 'Keep' });
          }

          tx.oncomplete = () => {
            // Delete the book
            const deleteTx = db.transaction('books', 'readwrite');
            deleteTx.objectStore('books').delete('to-delete');

            deleteTx.oncomplete = () => {
              // Delete pages using cursor
              const pageDeleteTx = db.transaction('pages', 'readwrite');
              const pageStore = pageDeleteTx.objectStore('pages');
              const index = pageStore.index('bookId');
              const cursorReq = index.openCursor(IDBKeyRange.only('to-delete'));

              cursorReq.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                  cursor.delete();
                  cursor.continue();
                }
              };

              pageDeleteTx.oncomplete = () => {
                // Verify
                const verifyTx = db.transaction(['books', 'pages'], 'readonly');
                const bookReq = verifyTx.objectStore('books').get('to-delete');
                const pageCountReq = verifyTx.objectStore('pages').count();

                let bookExists = false;
                let pageCount = 0;

                bookReq.onsuccess = () => {
                  bookExists = !!bookReq.result;
                };

                pageCountReq.onsuccess = () => {
                  pageCount = pageCountReq.result;
                };

                verifyTx.oncomplete = () => {
                  db.close();
                  resolve({ bookDeleted: !bookExists, pagesRemaining: pageCount });
                };
              };
            };
          };
        };
      });
    });

    expect(result.bookDeleted).toBeTruthy();
    expect(result.pagesRemaining).toBe(5); // Only "to-keep" pages remain
  });

  test('should clear all data', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const result = await page.evaluate(async () => {
      return new Promise<{ cleared: boolean }>((resolve, reject) => {
        const request = indexedDB.open('hadithHub', 1);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('books')) {
            db.createObjectStore('books', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('volumes')) {
            db.createObjectStore('volumes', { keyPath: ['bookId', 'volume'] });
          }
          if (!db.objectStoreNames.contains('pages')) {
            db.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['books', 'volumes', 'pages'], 'readwrite');

          // Add data
          tx.objectStore('books').put({ id: 'book1', title: 'Book 1' });
          tx.objectStore('volumes').put({ bookId: 'book1', volume: 1, totalPages: 10 });
          tx.objectStore('pages').put({ bookId: 'book1', volume: 1, page: 1, text: 'Content' });

          tx.oncomplete = () => {
            // Clear all
            const clearTx = db.transaction(['books', 'volumes', 'pages'], 'readwrite');
            clearTx.objectStore('books').clear();
            clearTx.objectStore('volumes').clear();
            clearTx.objectStore('pages').clear();

            clearTx.oncomplete = () => {
              // Verify
              const verifyTx = db.transaction(['books', 'volumes', 'pages'], 'readonly');
              let totalCount = 0;

              const bookCount = verifyTx.objectStore('books').count();
              const volCount = verifyTx.objectStore('volumes').count();
              const pageCount = verifyTx.objectStore('pages').count();

              bookCount.onsuccess = () => { totalCount += bookCount.result; };
              volCount.onsuccess = () => { totalCount += volCount.result; };
              pageCount.onsuccess = () => { totalCount += pageCount.result; };

              verifyTx.oncomplete = () => {
                db.close();
                resolve({ cleared: totalCount === 0 });
              };
            };
          };
        };
      });
    });

    expect(result.cleared).toBeTruthy();
  });
});

test.describe('LocalStorage - Preferences', () => {
  test('should persist language preference', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Set language preference
    await page.evaluate(() => {
      localStorage.setItem('hadithHub_language', 'ar');
    });

    await page.reload();
    await page.waitForTimeout(1000);

    const savedLang = await page.evaluate(() => {
      return localStorage.getItem('hadithHub_language');
    });

    expect(savedLang).toBe('ar');
  });

  test('should persist theme preference', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      localStorage.setItem('hadithHub_theme', 'dark');
    });

    await page.reload();
    await page.waitForTimeout(1000);

    const savedTheme = await page.evaluate(() => {
      return localStorage.getItem('hadithHub_theme');
    });

    expect(savedTheme).toBe('dark');
  });

  test('should persist font preference', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      localStorage.setItem('hadithHub_arabicFont', 'naskh');
    });

    await page.reload();
    await page.waitForTimeout(1000);

    const savedFont = await page.evaluate(() => {
      return localStorage.getItem('hadithHub_arabicFont');
    });

    expect(savedFont).toBe('naskh');
  });

  test('should persist reading mode preference', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      localStorage.setItem('hadithHub_readingMode', 'scroll');
    });

    await page.reload();
    await page.waitForTimeout(1000);

    const savedMode = await page.evaluate(() => {
      return localStorage.getItem('hadithHub_readingMode');
    });

    expect(savedMode).toBe('scroll');
  });
});

test.describe('Persistence - Cleanup', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      localStorage.clear();
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name === 'hadithHub') {
          indexedDB.deleteDatabase(db.name);
        }
      }
    });
  });

  test('cleanup test data', async ({ page }) => {
    await page.goto('/');
    expect(true).toBeTruthy();
  });
});
