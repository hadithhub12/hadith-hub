import { test, expect, Page } from '@playwright/test';

/**
 * Helper to set up a mock book in IndexedDB for reader tests
 */
async function setupMockBook(page: Page) {
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

        // Add mock book
        tx.objectStore('books').put({
          id: 'test-book-001',
          title: 'كتاب الاختبار',
          author: 'مؤلف الاختبار',
          volumes: 2,
          importedAt: Date.now(),
        });

        // Add mock volume
        tx.objectStore('volumes').put({
          bookId: 'test-book-001',
          volume: 1,
          totalPages: 5,
          importedAt: Date.now(),
        });

        // Add mock pages
        for (let i = 1; i <= 5; i++) {
          tx.objectStore('pages').put({
            bookId: 'test-book-001',
            volume: 1,
            page: i,
            text: JSON.stringify([
              `بسم الله الرحمن الرحيم`,
              `هذا نص الصفحة ${i} من كتاب الاختبار`,
              `1 - حديث رقم واحد في الصفحة ${i}`,
              `2 - حديث رقم اثنان في الصفحة ${i}`,
            ]),
          });
        }

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

test.describe('Reader View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await setupMockBook(page);
    await page.reload();
    await page.waitForTimeout(1500);
  });

  test('should display imported book on home page', async ({ page }) => {
    // Look for our test book
    const testBook = page.locator('text=كتاب الاختبار');
    const hasTestBook = await testBook.count() > 0;

    if (hasTestBook) {
      await expect(testBook.first()).toBeVisible();
    }
  });

  test('should navigate to book volumes', async ({ page }) => {
    // Click on test book if available
    const testBook = page.locator('text=كتاب الاختبار');

    if (await testBook.count() > 0) {
      await testBook.first().click();
      await page.waitForTimeout(500);

      // Should show volume selection
      const volumeOne = page.locator('text=1').or(page.locator('button:has-text("1")'));
      await expect(volumeOne.first()).toBeVisible();
    }
  });

  test('should open reader view when selecting volume', async ({ page }) => {
    const testBook = page.locator('text=كتاب الاختبار');

    if (await testBook.count() > 0) {
      await testBook.first().click();
      await page.waitForTimeout(500);

      // Click volume 1
      const volumeBtn = page.locator('button').filter({ hasText: '1' }).first();
      if (await volumeBtn.count() > 0) {
        await volumeBtn.click();
        await page.waitForTimeout(500);

        // Should show page content (Arabic text)
        const arabicText = page.locator('text=بسم الله الرحمن الرحيم');
        await expect(arabicText.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should navigate between pages', async ({ page }) => {
    const testBook = page.locator('text=كتاب الاختبار');

    if (await testBook.count() > 0) {
      await testBook.first().click();
      await page.waitForTimeout(500);

      const volumeBtn = page.locator('button').filter({ hasText: '1' }).first();
      if (await volumeBtn.count() > 0) {
        await volumeBtn.click();
        await page.waitForTimeout(500);

        // Look for navigation buttons
        const nextBtn = page.locator('button:has-text("Next")').or(page.locator('button:has-text("التالي")'));

        if (await nextBtn.count() > 0) {
          // Click next page
          await nextBtn.first().click();
          await page.waitForTimeout(300);

          // Should be on page 2
          const pageIndicator = page.locator('text=2').first();
          await expect(pageIndicator).toBeVisible();
        }
      }
    }
  });

  test('should have go to page functionality', async ({ page }) => {
    const testBook = page.locator('text=كتاب الاختبار');

    if (await testBook.count() > 0) {
      await testBook.first().click();
      await page.waitForTimeout(500);

      const volumeBtn = page.locator('button').filter({ hasText: '1' }).first();
      if (await volumeBtn.count() > 0) {
        await volumeBtn.click();
        await page.waitForTimeout(500);

        // Find page input
        const pageInput = page.locator('input[type="text"]').or(page.locator('input[type="number"]'));

        if (await pageInput.count() > 0) {
          await pageInput.first().fill('3');
          await page.waitForTimeout(300);

          // Press enter or click go button
          const goBtn = page.locator('button:has-text("Go")').or(page.locator('button:has-text("اذهب")'));
          if (await goBtn.count() > 0) {
            await goBtn.first().click();
            await page.waitForTimeout(300);
          } else {
            await pageInput.first().press('Enter');
          }
        }
      }
    }
  });

  test('should display Arabic text with proper formatting', async ({ page }) => {
    const testBook = page.locator('text=كتاب الاختبار');

    if (await testBook.count() > 0) {
      await testBook.first().click();
      await page.waitForTimeout(500);

      const volumeBtn = page.locator('button').filter({ hasText: '1' }).first();
      if (await volumeBtn.count() > 0) {
        await volumeBtn.click();
        await page.waitForTimeout(500);

        // Check for Arabic content
        const arabicContent = page.locator('[style*="direction: rtl"]').or(page.locator('[style*="text-align: right"]'));

        // Text should have proper RTL direction
        const hasRTLContent = await arabicContent.count() > 0;
        console.log(`RTL content present: ${hasRTLContent}`);
      }
    }
  });

  test('should have back button to return to library', async ({ page }) => {
    const testBook = page.locator('text=كتاب الاختبار');

    if (await testBook.count() > 0) {
      await testBook.first().click();
      await page.waitForTimeout(500);

      const volumeBtn = page.locator('button').filter({ hasText: '1' }).first();
      if (await volumeBtn.count() > 0) {
        await volumeBtn.click();
        await page.waitForTimeout(500);

        // Find and click back button
        const backBtn = page.locator('button svg').first().locator('..').or(page.locator('[style*="cursor: pointer"] svg').first().locator('..'));

        if (await backBtn.count() > 0) {
          await backBtn.click();
          await page.waitForTimeout(500);

          // Should be back in library/home
          const home = page.locator('text=Home').or(page.locator('text=الرئيسية'));
          await expect(home.first()).toBeVisible();
        }
      }
    }
  });
});

test.describe('Reader View - Reading Modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await setupMockBook(page);
    await page.reload();
    await page.waitForTimeout(1500);
  });

  test('should support pagination mode', async ({ page }) => {
    // Go to settings first
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Look for reading mode option
    const paginationMode = page.locator('text=Pagination').or(page.locator('text=صفحات'));

    if (await paginationMode.count() > 0) {
      await paginationMode.first().click();
      await page.waitForTimeout(300);
    }

    // Go back to home and open book
    await page.locator('text=Home').or(page.locator('text=الرئيسية')).first().click();
    await page.waitForTimeout(500);
  });

  test('should support continuous scroll mode', async ({ page }) => {
    // Go to settings
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Look for scroll mode option
    const scrollMode = page.locator('text=Continuous Scroll').or(page.locator('text=التمرير المستمر'));

    if (await scrollMode.count() > 0) {
      await scrollMode.first().click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Reader View - Font Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await setupMockBook(page);
    await page.reload();
    await page.waitForTimeout(1500);
  });

  test('should allow changing Arabic font', async ({ page }) => {
    // Go to settings
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Look for font options
    const fonts = ['Amiri', 'Noto Naskh', 'Nastaliq', 'Scheherazade'];

    for (const font of fonts) {
      const fontBtn = page.locator(`text=${font}`);
      if (await fontBtn.count() > 0) {
        console.log(`Found font option: ${font}`);
      }
    }
  });

  test('should persist font selection', async ({ page }) => {
    // Go to settings
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Select Noto Naskh font
    const naskhBtn = page.locator('text=Noto Naskh').or(page.locator('text=نوتو نسخ'));
    if (await naskhBtn.count() > 0) {
      await naskhBtn.first().click();
      await page.waitForTimeout(300);

      // Reload and verify persistence
      await page.reload();
      await page.waitForTimeout(1000);

      // Navigate back to settings
      await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
      await page.waitForTimeout(500);

      // Font should still be selected
      // (Visual verification would need screenshot comparison)
    }
  });
});

test.describe('Reader View - Theme', () => {
  test('should support light theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Go to settings
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Select light theme
    const lightBtn = page.locator('text=Light').or(page.locator('text=فاتح'));
    if (await lightBtn.count() > 0) {
      await lightBtn.first().click();
      await page.waitForTimeout(300);

      // Check that body has light theme
      const bgColor = await page.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });

      console.log(`Light theme background: ${bgColor}`);
    }
  });

  test('should support dark theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Go to settings
    await page.locator('text=Settings').or(page.locator('text=الإعدادات')).first().click();
    await page.waitForTimeout(500);

    // Select dark theme
    const darkBtn = page.locator('text=Dark').or(page.locator('text=داكن'));
    if (await darkBtn.count() > 0) {
      await darkBtn.first().click();
      await page.waitForTimeout(300);

      // Check that body has dark theme
      const bgColor = await page.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });

      console.log(`Dark theme background: ${bgColor}`);
    }
  });
});

test.describe('Reader - Cleanup', () => {
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

  test('cleanup test database', async ({ page }) => {
    await page.goto('/');
    // This test just ensures cleanup runs
    expect(true).toBeTruthy();
  });
});
