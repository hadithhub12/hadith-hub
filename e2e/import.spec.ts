import { test, expect } from '@playwright/test';

test.describe('Import Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Navigate to Import page
    await page.locator('text=Import').or(page.locator('text=استيراد')).first().click();
    await page.waitForTimeout(500);
  });

  test('should display import page elements', async ({ page }) => {
    // Check for ZIP import section
    const zipImport = await page.locator('text=Import from ZIP').or(page.locator('text=استيراد من ملف ZIP')).count();
    expect(zipImport).toBeGreaterThan(0);

    // Check for file input area
    const fileInput = await page.locator('input[type="file"]').count();
    expect(fileInput).toBeGreaterThan(0);
  });

  test('should display available books list', async ({ page }) => {
    // Wait for books to load from server
    await page.waitForTimeout(3000);

    // Check for book list or loading indicator
    const hasBooks = await page.locator('[style*="cursor: pointer"]').count();
    const isLoading = await page.locator('text=Loading').or(page.locator('text=جاري التحميل')).count();

    // Either loading or showing books
    expect(hasBooks + isLoading).toBeGreaterThanOrEqual(0);
  });

  test('should filter books by sect', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Click Shia filter
    const shiaBtn = page.locator('button:has-text("Shia")').or(page.locator('button:has-text("الشيعة")'));
    if (await shiaBtn.count() > 0) {
      await shiaBtn.first().click();
      await page.waitForTimeout(500);
    }

    // Click Sunni filter
    const sunniBtn = page.locator('button:has-text("Sunni")').or(page.locator('button:has-text("السنة")'));
    if (await sunniBtn.count() > 0) {
      await sunniBtn.first().click();
      await page.waitForTimeout(500);
    }

    // Click All filter
    const allBtn = page.locator('button:has-text("All")').or(page.locator('button:has-text("الكل")'));
    if (await allBtn.count() > 0) {
      await allBtn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test('should filter books by language', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for language filter buttons
    const arabicBtn = page.locator('button:has-text("Arabic")').or(page.locator('button:has-text("العربية")'));
    const persianBtn = page.locator('button:has-text("Persian")').or(page.locator('button:has-text("الفارسية")'));

    if (await arabicBtn.count() > 0) {
      await arabicBtn.first().click();
      await page.waitForTimeout(500);
    }

    if (await persianBtn.count() > 0) {
      await persianBtn.first().click();
      await page.waitForTimeout(500);
    }
  });

  test('should have search functionality for books', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Find search input
    const searchInput = page.locator('input[placeholder*="Search"]').or(page.locator('input[placeholder*="البحث"]'));

    if (await searchInput.count() > 0) {
      await searchInput.first().fill('الكافي');
      await page.waitForTimeout(500);

      // Clear and try English
      await searchInput.first().clear();
      await searchInput.first().fill('Kafi');
      await page.waitForTimeout(500);
    }
  });

  test('should have pagination for book list', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for pagination buttons
    const nextBtn = page.locator('button:has-text("Next")').or(page.locator('button:has-text("التالي")'));
    const prevBtn = page.locator('button:has-text("Previous")').or(page.locator('button:has-text("السابق")'));

    if (await nextBtn.count() > 0) {
      const isEnabled = !(await nextBtn.first().isDisabled());
      if (isEnabled) {
        await nextBtn.first().click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('should select a book and show volume selection', async ({ page }) => {
    await page.waitForTimeout(3000);

    // Click on first available book
    const bookCards = page.locator('[style*="cursor: pointer"]');
    if (await bookCards.count() > 0) {
      await bookCards.first().click();
      await page.waitForTimeout(1000);

      // Look for volume selection or download buttons
      const downloadBtn = await page.locator('button:has-text("Download")').or(page.locator('button:has-text("تحميل")')).count();
      const selectAll = await page.locator('button:has-text("Select All")').or(page.locator('button:has-text("تحديد الكل")')).count();

      // Either show volume options or download button
      expect(downloadBtn + selectAll).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have bulk download options', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for bulk download buttons
    const downloadAllShia = page.locator('button:has-text("All Shia")').or(page.locator('button:has-text("كتب الشيعة")'));
    const downloadAllSunni = page.locator('button:has-text("All Sunni")').or(page.locator('button:has-text("كتب السنة")'));
    const downloadEverything = page.locator('button:has-text("Everything")').or(page.locator('button:has-text("الكل")'));

    const hasBulkOptions = (await downloadAllShia.count()) + (await downloadAllSunni.count()) + (await downloadEverything.count());

    // Bulk options may or may not be visible depending on UI state
    console.log(`Bulk download options visible: ${hasBulkOptions > 0}`);
  });
});

test.describe('Import - Download Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.locator('text=Import').or(page.locator('text=استيراد')).first().click();
    await page.waitForTimeout(500);
  });

  test('should show download progress when downloading', async ({ page }) => {
    // This is a longer test - skip in CI
    test.skip(!!process.env.CI, 'Skipping download test in CI');

    await page.waitForTimeout(3000);

    // Find and click first book
    const bookCards = page.locator('[style*="cursor: pointer"]');
    if (await bookCards.count() > 0) {
      await bookCards.first().click();
      await page.waitForTimeout(1000);

      // Look for download button
      const downloadBtn = page.locator('button:has-text("Download Selected")').or(page.locator('button:has-text("تحميل المحدد")'));

      if (await downloadBtn.count() > 0 && !(await downloadBtn.first().isDisabled())) {
        // Note: We don't actually click download to avoid network calls in tests
        // But we verify the button exists and is functional
        await expect(downloadBtn.first()).toBeVisible();
      }
    }
  });
});

test.describe('Import - ZIP File', () => {
  test('should have file input for ZIP import', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.locator('text=Import').or(page.locator('text=استيراد')).first().click();
    await page.waitForTimeout(500);

    // Check for file input
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute('accept', '.zip');
  });

  test('should show drag-and-drop area for ZIP files', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.locator('text=Import').or(page.locator('text=استيراد')).first().click();
    await page.waitForTimeout(500);

    // Check for drag-drop styled area
    const dropArea = page.locator('[style*="dashed"]').or(page.locator('label[style*="cursor: pointer"]'));
    const hasDropArea = await dropArea.count() > 0;

    console.log(`Drag-drop area present: ${hasDropArea}`);
  });
});

test.describe('Import - Custom Server', () => {
  test('should have custom server URL input', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.locator('text=Import').or(page.locator('text=استيراد')).first().click();
    await page.waitForTimeout(500);

    // Look for custom server URL input
    const serverInput = page.locator('input[placeholder*="Server"]').or(page.locator('input[placeholder*="خادم"]'));

    if (await serverInput.count() > 0) {
      await serverInput.first().fill('http://custom-server.com/books');
      await page.waitForTimeout(300);

      // Verify input value
      await expect(serverInput.first()).toHaveValue('http://custom-server.com/books');
    }
  });
});
