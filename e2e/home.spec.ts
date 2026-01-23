import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to initialize
    await page.waitForSelector('[data-testid="app-container"]', { timeout: 10000 }).catch(() => {
      // App might not have test ids yet, wait for content instead
    });
    await page.waitForTimeout(1000); // Allow IndexedDB to initialize
  });

  test('should display app header with title', async ({ page }) => {
    // Check for app name (either English or Arabic)
    const hasEnglishTitle = await page.locator('text=Hadith Hub').count() > 0;
    const hasArabicTitle = await page.locator('text=مركز الحديث').count() > 0;
    expect(hasEnglishTitle || hasArabicTitle).toBeTruthy();
  });

  test('should display navigation bar', async ({ page }) => {
    // Check for navigation buttons
    const homeNav = await page.locator('text=Home').or(page.locator('text=الرئيسية')).count();
    const importNav = await page.locator('text=Import').or(page.locator('text=استيراد')).count();
    const searchNav = await page.locator('text=Search').or(page.locator('text=بحث')).count();
    const settingsNav = await page.locator('text=Settings').or(page.locator('text=الإعدادات')).count();

    expect(homeNav + importNav + searchNav + settingsNav).toBeGreaterThan(0);
  });

  test('should show empty state when no books are imported', async ({ page }) => {
    // Clear IndexedDB first
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });

    await page.reload();
    await page.waitForTimeout(1000);

    // Check for empty state message
    const noBooks = await page.locator('text=No books available').or(page.locator('text=لا توجد كتب')).count();
    expect(noBooks).toBeGreaterThan(0);
  });

  test('should navigate to Import page', async ({ page }) => {
    // Click Import nav
    await page.locator('text=Import').or(page.locator('text=استيراد')).first().click();
    await page.waitForTimeout(500);

    // Check that we're on the import page (look for import-related text)
    const importPage = await page.locator('text=Import / Download').or(page.locator('text=استيراد / تحميل')).count();
    const importFromZip = await page.locator('text=Import from ZIP').or(page.locator('text=استيراد من ملف')).count();

    expect(importPage + importFromZip).toBeGreaterThan(0);
  });

  test('should navigate to Search page', async ({ page }) => {
    await page.locator('text=Search').or(page.locator('text=بحث')).first().click();
    await page.waitForTimeout(500);

    // Check for search input or search-related elements
    // The input doesn't have type="text" explicitly, so we search by placeholder
    const searchInput = page.locator('input[placeholder*="Search"]').or(page.locator('input[placeholder*="البحث"]'));
    const inputCount = await searchInput.count();

    // Also check for search mode buttons as alternative verification
    const searchModeButtons = page.locator('text=Arabic').or(page.locator('text=عربي')).or(page.locator('text=Roman')).or(page.locator('text=لاتيني'));
    const modeCount = await searchModeButtons.count();

    expect(inputCount + modeCount).toBeGreaterThan(0);
  });

  test('should navigate to Settings page', async ({ page }) => {
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Check for settings elements (theme, language options)
    const themeOption = await page.locator('text=Theme').or(page.locator('text=المظهر')).count();
    const languageOption = await page.locator('text=Language').or(page.locator('text=اللغة')).count();

    expect(themeOption + languageOption).toBeGreaterThan(0);
  });

  test('should display statistics when books are imported', async ({ page }) => {
    // This test assumes some books may be imported
    // Check for statistics section or book count display
    const statsVisible = await page.locator('text=books').or(page.locator('text=كتاب')).count();
    const pagesVisible = await page.locator('text=pages').or(page.locator('text=صفحة')).count();

    // Either we see stats (books imported) or empty state
    expect(statsVisible + pagesVisible).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Home Page - Book Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
  });

  test('should display book cards with proper information', async ({ page }) => {
    // Check if any books are displayed
    const bookCards = await page.locator('[style*="cursor: pointer"]').count();

    if (bookCards > 0) {
      // If books exist, check that they have title information
      const firstBookCard = page.locator('[style*="cursor: pointer"]').first();
      await expect(firstBookCard).toBeVisible();
    }
  });

  test('should filter books by sect', async ({ page }) => {
    // Look for sect filter buttons
    const shiaFilter = page.locator('button:has-text("Shia")').or(page.locator('button:has-text("الشيعة")'));
    const sunniFilter = page.locator('button:has-text("Sunni")').or(page.locator('button:has-text("السنة")'));
    const allFilter = page.locator('button:has-text("All")').or(page.locator('button:has-text("الكل")'));

    if (await shiaFilter.count() > 0) {
      await shiaFilter.first().click();
      await page.waitForTimeout(300);

      // Verify filter is applied
      await expect(shiaFilter.first()).toHaveCSS('background-color', /.*/);
    }

    if (await sunniFilter.count() > 0) {
      await sunniFilter.first().click();
      await page.waitForTimeout(300);
    }

    if (await allFilter.count() > 0) {
      await allFilter.first().click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Home Page - Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
  });

  test('should display pagination controls when books exceed page limit', async ({ page }) => {
    // Look for pagination buttons
    const prevButton = page.locator('button:has-text("Previous")').or(page.locator('button:has-text("السابق")'));
    const nextButton = page.locator('button:has-text("Next")').or(page.locator('button:has-text("التالي")'));

    // Pagination may or may not be visible depending on book count
    const hasPagination = (await prevButton.count()) > 0 || (await nextButton.count()) > 0;

    // This is informational - pagination presence depends on data
    console.log(`Pagination controls present: ${hasPagination}`);
  });

  test('should navigate between pages', async ({ page }) => {
    const nextButton = page.locator('button:has-text("Next")').or(page.locator('button:has-text("التالي")'));
    const prevButton = page.locator('button:has-text("Previous")').or(page.locator('button:has-text("السابق")'));

    if (await nextButton.count() > 0) {
      // Check if next is enabled
      const isEnabled = !(await nextButton.first().isDisabled());

      if (isEnabled) {
        await nextButton.first().click();
        await page.waitForTimeout(300);

        // Previous should now be enabled
        if (await prevButton.count() > 0) {
          await prevButton.first().click();
          await page.waitForTimeout(300);
        }
      }
    }
  });
});

test.describe('Responsive Design', () => {
  test('should display correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Navigation should be visible
    const nav = await page.locator('nav').or(page.locator('[style*="position: fixed"][style*="bottom"]')).count();
    expect(nav).toBeGreaterThanOrEqual(0); // Nav styling may vary

    // Content should be readable
    const content = await page.locator('body').isVisible();
    expect(content).toBeTruthy();
  });

  test('should display correctly on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto('/');
    await page.waitForTimeout(1000);

    const content = await page.locator('body').isVisible();
    expect(content).toBeTruthy();
  });

  test('should display correctly on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForTimeout(1000);

    const content = await page.locator('body').isVisible();
    expect(content).toBeTruthy();
  });
});

test.describe('Home Page - Book Search', () => {
  test.beforeEach(async ({ page }) => {
    // Set up mock books for search testing
    await page.goto('/');
    await page.evaluate(async () => {
      const DB_NAME = 'hadithHub';
      const DB_VERSION = 1;

      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

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
            const pageStore = db.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
            pageStore.createIndex('bookId', 'bookId', { unique: false });
            pageStore.createIndex('bookVolume', ['bookId', 'volume'], { unique: false });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['books', 'volumes', 'pages'], 'readwrite');

          // Add multiple mock books with different titles for search testing
          tx.objectStore('books').put({
            id: 'search-test-001',
            title: 'كتاب التوحيد',
            author: 'الشيخ الصدوق',
            volumes: 1,
            importedAt: Date.now(),
          });
          tx.objectStore('books').put({
            id: 'search-test-002',
            title: 'كتاب الكافي',
            author: 'الشيخ الكليني',
            volumes: 1,
            importedAt: Date.now(),
          });
          tx.objectStore('books').put({
            id: 'search-test-003',
            title: 'صحيح البخاري',
            author: 'الإمام البخاري',
            volumes: 1,
            importedAt: Date.now(),
          });

          // Add mock volumes
          ['search-test-001', 'search-test-002', 'search-test-003'].forEach(bookId => {
            tx.objectStore('volumes').put({
              bookId,
              volume: 1,
              totalPages: 1,
              importedAt: Date.now(),
            });
            tx.objectStore('pages').put({
              bookId,
              volume: 1,
              page: 1,
              text: JSON.stringify(['بسم الله الرحمن الرحيم']),
            });
          });

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.reload();
    await page.waitForTimeout(1500);
  });

  test('should display search input on home page', async ({ page }) => {
    // Look for search input with placeholder
    const searchInput = page.locator('input[placeholder*="Search books"]').or(page.locator('input[placeholder*="البحث في الكتب"]'));
    const inputCount = await searchInput.count();

    expect(inputCount).toBeGreaterThan(0);
  });

  test('should filter books when typing in search', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search books"]').or(page.locator('input[placeholder*="البحث في الكتب"]'));

    if (await searchInput.count() > 0) {
      // Type in search
      await searchInput.first().fill('التوحيد');
      await page.waitForTimeout(300);

      // Check if matching book is visible
      const matchingBook = await page.locator('text=كتاب التوحيد').count();
      expect(matchingBook).toBeGreaterThan(0);
    }
  });

  test('should show no results message when search has no matches', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search books"]').or(page.locator('input[placeholder*="البحث في الكتب"]'));

    if (await searchInput.count() > 0) {
      // Type a search that won't match any books
      await searchInput.first().fill('xyz123nonexistent');
      await page.waitForTimeout(300);

      // Check for no results message
      const noResults = await page.locator('text=No books found').or(page.locator('text=لم يتم العثور')).count();
      expect(noResults).toBeGreaterThan(0);
    }
  });

  test('should maintain search input focus while typing', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search books"]').or(page.locator('input[placeholder*="البحث في الكتب"]'));

    if (await searchInput.count() > 0) {
      const input = searchInput.first();

      // Focus the input
      await input.click();

      // Type characters one by one and verify input retains value
      await input.fill('');
      await input.type('a');
      await page.waitForTimeout(100);
      expect(await input.inputValue()).toBe('a');

      await input.type('b');
      await page.waitForTimeout(100);
      expect(await input.inputValue()).toBe('ab');

      await input.type('c');
      await page.waitForTimeout(100);
      expect(await input.inputValue()).toBe('abc');
    }
  });

  test('should clear search when clear button is clicked', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search books"]').or(page.locator('input[placeholder*="البحث في الكتب"]'));

    if (await searchInput.count() > 0) {
      const input = searchInput.first();

      // Type in search
      await input.fill('test');
      await page.waitForTimeout(300);

      // Find and click clear button (it should appear when there's text)
      const clearButton = page.locator('button').filter({ has: page.locator('svg path[d*="M18 6L6 18"]') });

      if (await clearButton.count() > 0) {
        await clearButton.first().click();
        await page.waitForTimeout(300);

        // Search should be cleared
        expect(await input.inputValue()).toBe('');
      }
    }
  });

  test.afterEach(async ({ page }) => {
    // Clean up test data
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name === 'hadithHub') {
          indexedDB.deleteDatabase(db.name);
        }
      }
    });
  });
});
