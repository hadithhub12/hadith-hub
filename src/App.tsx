import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import './index.css';
import { getBookDisplayName, hasBookMetadata } from './bookMetadata';

// GitHub-hosted data URL (default source)
const GITHUB_DATA_URL = 'https://raw.githubusercontent.com/hadithhub12/hadith-data/main';

// Responsive breakpoints
const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
  largeDesktop: 1440,
};

// Custom hook for responsive design
function useResponsive() {
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 375);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    isMobile: windowWidth < BREAKPOINTS.tablet,
    isTablet: windowWidth >= BREAKPOINTS.tablet && windowWidth < BREAKPOINTS.desktop,
    isDesktop: windowWidth >= BREAKPOINTS.desktop,
    isLargeDesktop: windowWidth >= BREAKPOINTS.largeDesktop,
    windowWidth,
  };
}

// Types
interface Page {
  id?: string;
  bookId: string;
  volume: number;
  page: number;
  text: string;
}

interface Book {
  id: string;
  title: string;
  author?: string;
  volumes: number;
  importedAt?: number;
}

interface VolumeInfo {
  id?: string;
  bookId: string;
  volume: number;
  totalPages: number;
  importedAt?: number;
}

type ViewType = 'home' | 'library' | 'reader' | 'import' | 'settings' | 'search' | 'searchResults';
type Language = 'en' | 'ar';
type Theme = 'light' | 'dark';
type ArabicFont = 'amiri' | 'naskh' | 'nastaliq' | 'scheherazade';

// Arabic font definitions with display names and CSS font-family values
const ARABIC_FONTS: Record<ArabicFont, { family: string; displayName: string; displayNameAr: string }> = {
  amiri: { family: "'Amiri', serif", displayName: 'Amiri', displayNameAr: 'أميري' },
  naskh: { family: "'Noto Naskh Arabic', serif", displayName: 'Noto Naskh', displayNameAr: 'نوتو نسخ' },
  nastaliq: { family: "'Noto Nastaliq Urdu', serif", displayName: 'Nastaliq (Indo-Pak)', displayNameAr: 'نستعليق (هندي)' },
  scheherazade: { family: "'Scheherazade New', serif", displayName: 'Scheherazade', displayNameAr: 'شهرزاد' },
};

interface SearchResult {
  bookId: string;
  bookTitle: string;
  volume: number;
  page: number;
  snippet: string;
  matchIndex: number;
}

interface AvailableDownload {
  filename: string;
  volume: number;
  size: number;
  sizeFormatted: string;
  downloadUrl: string;
  bookId: string;
  bookTitle: string;
  language?: string;
}

interface AvailableBook {
  slug: string;
  bookId: string;
  sourceBookId?: string;
  bookTitle: string;
  bookTitleAr?: string;
  bookTitleEn?: string;
  author?: string;
  authorAr?: string;
  authorEn?: string;
  total: number;
  downloads: AvailableDownload[];
  bookLanguage?: 'ar' | 'fa' | 'en';  // Language of the book content
}

type SearchMode = 'exact' | 'root';
type InputMode = 'arabic' | 'roman';
type ImportMode = 'arabic' | 'english';
type SectFilter = 'all' | 'shia' | 'sunni';
type LanguageFilter = 'all' | 'ar' | 'fa' | 'en';
type ReadingMode = 'pagination' | 'scroll';

// Book sect categorization - most books in this library are Shia
// Books explicitly marked as Sunni sources or from Sunni authors
const SUNNI_BOOK_IDS = new Set([
  // Sunni hadith collections and commentaries
  '59624',  // غريب الحديث (لأبي عبید) - Abu Ubayd
  '59622',  // غريب الحديث (خطابي) - al-Khattabi
  '109591', // غريب الحديث (ابن جوزی) - Ibn al-Jawzi
  '17077',  // غریب الحدیث (إبن قتیبة) - Ibn Qutayba
  '02384',  // النهایة في غریب الحدیث - Ibn al-Athir
  '00779',  // الفائق في غريب الحديث - al-Zamakhshari
  '25568',  // المجموع المغيث - al-Maqdisi
  '66642',  // فردوس الأخبار - al-Daylami (Sunni)
  '01484',  // شرح نهج البلاغة لإبن أبی الحديد - Ibn Abi al-Hadid (Mu'tazili/Sunni perspective)
  '124740', // الروض النضير - al-Siyaghi (Zaydi)
]);

// Get sect for a book based on its ID
function getBookSect(bookId: string): 'shia' | 'sunni' {
  // Check if it's in Sunni list
  if (SUNNI_BOOK_IDS.has(bookId)) {
    return 'sunni';
  }
  // Default to Shia (majority of this collection)
  return 'shia';
}

// Arabic diacritics (tashkeel) to remove for root matching
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;

// Normalize Arabic text (remove diacritics and normalize alef/yaa variations)
function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, '')
    // Normalize Alef variations
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Yaa variations
    .replace(/[ىئ]/g, 'ي')
    // Normalize Taa Marbuta
    .replace(/ة/g, 'ه')
    // Normalize Hamza
    .replace(/[ؤء]/g, '');
}

// Roman to Arabic transliteration map
const ROMAN_TO_ARABIC: Record<string, string> = {
  // Special combinations (longest first for proper matching)
  'ahlulbayt': 'اهل البيت', 'ahlul': 'اهل',
  'allah': 'الله', 'muhammad': 'محمد', 'mohammad': 'محمد',
  'hussein': 'حسين', 'husain': 'حسين', 'hasan': 'حسن',
  'hadith': 'حديث', 'quran': 'قران', 'rasul': 'رسول',
  'salat': 'صلاة', 'zakat': 'زكاة', 'sawm': 'صوم',
  'iman': 'ايمان', 'islam': 'اسلام', 'muslim': 'مسلم',
  'deen': 'دين', 'kitab': 'كتاب', 'rabb': 'رب',
  'jannah': 'جنه', 'jahannam': 'جهنم', 'shaytan': 'شيطان',
  'malaika': 'ملائكه', 'sahabah': 'صحابه', 'sunnah': 'سنه',
  'fatwa': 'فتوى', 'fiqh': 'فقه', 'masjid': 'مسجد',
  'kabah': 'كعبه', 'makkah': 'مكه', 'madinah': 'مدينه',
  'imam': 'امام', 'nabi': 'نبي', 'hajj': 'حج',
  'bayt': 'بيت', 'ilm': 'علم', 'aql': 'عقل',
  'nafs': 'نفس', 'ruh': 'روح', 'qalb': 'قلب',
  'ali': 'علي', 'din': 'دين', 'ahl': 'اهل',
  // Two-letter combinations
  'th': 'ث', 'kh': 'خ', 'dh': 'ذ', 'sh': 'ش', 'gh': 'غ',
  'aa': 'ا', 'ee': 'ي', 'ii': 'ي', 'oo': 'و', 'uu': 'و',
  'al': 'ال', 'h2': 'ه',
  // Single letter mappings
  'a': 'ا', 'b': 'ب', 't': 'ت', 'j': 'ج', 'h': 'ح',
  'd': 'د', 'r': 'ر', 'z': 'ز', 's': 'س', 'S': 'ص',
  'D': 'ض', 'T': 'ط', 'Z': 'ظ', "'": 'ع', 'f': 'ف', 'q': 'ق',
  'k': 'ك', 'l': 'ل', 'm': 'م', 'n': 'ن', 'w': 'و', 'y': 'ي',
  'i': 'ي', 'u': 'و', 'o': 'و', 'e': 'ي',
};

// Convert Roman text to Arabic
function romanToArabic(text: string): string {
  let result = text.toLowerCase();

  // First, replace known words/phrases (longest first)
  const sortedKeys = Object.keys(ROMAN_TO_ARABIC).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const regex = new RegExp(key, 'gi');
    result = result.replace(regex, ROMAN_TO_ARABIC[key]);
  }

  return result;
}

// Check if text contains Roman characters (useful for auto-detection)
function containsRoman(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

// Export for potential use
void containsRoman;

// Translations
const translations = {
  en: {
    appName: 'Hadith Hub',
    appSubtitle: 'Islamic Library',
    home: 'Home',
    import: 'Import',
    settings: 'Settings',
    noBooks: 'No books available',
    importBook: 'Import Book',
    volumes: 'volumes',
    volume: 'Volume',
    noVolumes: 'No volumes available',
    importDownload: 'Import / Download',
    importFromZip: 'Import from ZIP file',
    tapToSelectZip: 'Tap to select a ZIP file',
    serverUrl: 'Custom Server URL (optional)',
    downloadSuccess: 'Download successful',
    downloadFailed: 'Download failed',
    importSuccess: 'Import successful',
    importFailed: 'Import failed',
    manifestNotFound: 'manifest.json not found',
    enterValidNumbers: 'Please enter valid numbers',
    statistics: 'Statistics',
    books: 'books',
    pages: 'pages',
    deleteAllData: 'Delete All Data',
    dataDeleted: 'Data deleted',
    of: 'of',
    next: 'Next',
    previous: 'Previous',
    pageNotAvailable: 'Page not available',
    language: 'Language',
    english: 'English',
    arabic: 'العربية',
    importing: 'Importing...',
    availableVolumes: 'Available Volumes',
    selectVolumes: 'Select volumes to download',
    loadingVolumes: 'Loading available volumes...',
    noVolumesAvailable: 'No volumes available on server',
    downloadSelected: 'Download Selected',
    downloadAll: 'Download All',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    volumesSelected: 'volumes selected',
    downloading: 'Downloading...',
    search: 'Search',
    searchPlaceholder: 'Search in books...',
    searchResults: 'Search Results',
    noResults: 'No results found',
    resultsFound: 'results found',
    backToSearch: 'Back to Search',
    searching: 'Searching...',
    page: 'Page',
    backToResults: 'Back to Results',
    searchMode: 'Match Type',
    inputMode: 'Input',
    exactMatch: 'Exact',
    rootMatch: 'Root',
    arabicInput: 'Arabic',
    romanInput: 'Roman',
    exactMatchDesc: 'Match exact text',
    rootMatchDesc: 'Ignores diacritics',
    arabicInputDesc: 'Arabic keyboard',
    romanInputDesc: 'English letters',
    goToPage: 'Go',
    convertedTo: 'Searching for',
    theme: 'Theme',
    lightMode: 'Light',
    darkMode: 'Dark',
    translations: 'Translations',
    downloadTranslations: 'Download English Translations',
    showTranslation: 'Show Translation',
    hideTranslation: 'Hide Translation',
    noTranslation: 'No translation available',
    englishTranslation: 'English Translation',
    arabicVolumes: 'Arabic',
    englishVolumes: 'English',
    noTranslationsAvailable: 'No English translations available yet',
    // Sect categorization
    shiaBooks: 'Shia Books',
    sunniBooks: 'Sunni Books',
    allBooks: 'All Books',
    shia: 'Shia',
    sunni: 'Sunni',
    all: 'All',
    filterBySect: 'Filter by Sect',
    // Language categorization
    filterByLanguage: 'Filter by Language',
    arabicBooks: 'Arabic',
    persianBooks: 'Persian',
    englishBooks: 'English',
    comingSoon: 'Coming Soon',
    selectBooks: 'Select Books',
    allBooksSelected: 'All books',
    booksSelected: 'books selected',
    // Pagination
    previousPage: 'Previous',
    nextPage: 'Next',
    pageOf: 'Page',
    // Bulk download
    downloadAllShia: 'Download All Shia',
    downloadAllSunni: 'Download All Sunni',
    downloadAllBooks: 'Download Everything',
    downloadingAllBooks: 'Downloading...',
    booksDownloaded: 'books done',
    // Import search
    searchBooksPlaceholder: 'Search books by name...',
    booksFound: 'books found',
    showingBooks: 'Showing',
    ofBooks: 'of',
    noResultsFound: 'No books found',
    // Font settings
    arabicFont: 'Arabic Font',
    fontAmiri: 'Amiri',
    fontNaskh: 'Noto Naskh',
    fontNastaliq: 'Nastaliq (Indo-Pak)',
    fontScheherazade: 'Scheherazade',
    // Reading mode
    readingMode: 'Reading Mode',
    paginationMode: 'Pagination',
    scrollMode: 'Continuous Scroll',
    paginationDesc: 'One page at a time',
    scrollDesc: 'Scroll through all pages',
    // Delete book
    deleteBook: 'Delete Book',
    deleteBookConfirm: 'Are you sure you want to delete this book and all its data?',
    bookDeleted: 'Book deleted successfully',
    // Help
    help: 'Help & Guide',
    userGuide: 'User Guide',
    userGuideDesc: 'Learn how to use the app',
    openGuide: 'Open Guide',
  },
  ar: {
    appName: 'مركز الحديث',
    appSubtitle: 'المكتبة الإسلامية',
    home: 'الرئيسية',
    import: 'استيراد',
    settings: 'الإعدادات',
    noBooks: 'لا توجد كتب',
    importBook: 'استيراد كتاب',
    volumes: 'مجلد',
    volume: 'المجلد',
    noVolumes: 'لا توجد مجلدات',
    importDownload: 'استيراد / تحميل',
    importFromZip: 'استيراد من ملف ZIP',
    tapToSelectZip: 'اضغط لاختيار ملف ZIP',
    serverUrl: 'عنوان خادم مخصص (اختياري)',
    downloadSuccess: 'تم التحميل بنجاح',
    downloadFailed: 'فشل التحميل',
    importSuccess: 'تم الاستيراد بنجاح',
    importFailed: 'فشل الاستيراد',
    manifestNotFound: 'manifest.json غير موجود',
    enterValidNumbers: 'يرجى إدخال أرقام صحيحة',
    statistics: 'إحصائيات',
    books: 'كتاب',
    pages: 'صفحة',
    deleteAllData: 'حذف جميع البيانات',
    dataDeleted: 'تم الحذف',
    of: 'من',
    next: 'التالي',
    previous: 'السابق',
    pageNotAvailable: 'الصفحة غير متوفرة',
    language: 'اللغة',
    english: 'English',
    arabic: 'العربية',
    importing: 'جاري الاستيراد...',
    availableVolumes: 'المجلدات المتاحة',
    selectVolumes: 'اختر المجلدات للتحميل',
    loadingVolumes: 'جاري تحميل المجلدات المتاحة...',
    noVolumesAvailable: 'لا توجد مجلدات متاحة على الخادم',
    downloadSelected: 'تحميل المحدد',
    downloadAll: 'تحميل الكل',
    selectAll: 'تحديد الكل',
    deselectAll: 'إلغاء التحديد',
    volumesSelected: 'مجلد محدد',
    downloading: 'جاري التحميل...',
    search: 'بحث',
    searchPlaceholder: 'البحث في الكتب...',
    searchResults: 'نتائج البحث',
    noResults: 'لا توجد نتائج',
    resultsFound: 'نتيجة',
    backToSearch: 'العودة للبحث',
    searching: 'جاري البحث...',
    page: 'صفحة',
    backToResults: 'العودة للنتائج',
    searchMode: 'نوع المطابقة',
    inputMode: 'الإدخال',
    exactMatch: 'مطابق',
    rootMatch: 'جذر',
    arabicInput: 'عربي',
    romanInput: 'لاتيني',
    exactMatchDesc: 'مطابقة النص بالضبط',
    rootMatchDesc: 'بدون تشكيل',
    arabicInputDesc: 'لوحة مفاتيح عربية',
    romanInputDesc: 'حروف إنجليزية',
    goToPage: 'اذهب',
    convertedTo: 'البحث عن',
    theme: 'المظهر',
    lightMode: 'فاتح',
    darkMode: 'داكن',
    translations: 'الترجمات',
    downloadTranslations: 'تحميل الترجمة الإنجليزية',
    showTranslation: 'إظهار الترجمة',
    hideTranslation: 'إخفاء الترجمة',
    noTranslation: 'لا توجد ترجمة',
    englishTranslation: 'الترجمة الإنجليزية',
    arabicVolumes: 'عربي',
    englishVolumes: 'إنجليزي',
    noTranslationsAvailable: 'لا توجد ترجمات إنجليزية متاحة حالياً',
    // Sect categorization
    shiaBooks: 'كتب الشيعة',
    sunniBooks: 'كتب أهل السنة',
    allBooks: 'جميع الكتب',
    shia: 'الشيعة',
    sunni: 'السنة',
    all: 'الكل',
    filterBySect: 'تصفية حسب المذهب',
    // Language categorization
    filterByLanguage: 'تصفية حسب اللغة',
    arabicBooks: 'العربية',
    persianBooks: 'الفارسية',
    englishBooks: 'الإنجليزية',
    comingSoon: 'قريباً',
    selectBooks: 'اختر الكتب',
    allBooksSelected: 'جميع الكتب',
    booksSelected: 'كتب مختارة',
    // Pagination
    previousPage: 'السابق',
    nextPage: 'التالي',
    pageOf: 'صفحة',
    // Bulk download
    downloadAllShia: 'تحميل كتب الشيعة',
    downloadAllSunni: 'تحميل كتب السنة',
    downloadAllBooks: 'تحميل الكل',
    downloadingAllBooks: 'جاري التحميل...',
    booksDownloaded: 'كتب تم تحميلها',
    // Import search
    searchBooksPlaceholder: 'البحث في الكتب...',
    booksFound: 'كتاب',
    showingBooks: 'عرض',
    ofBooks: 'من',
    noResultsFound: 'لم يتم العثور على كتب',
    // Font settings
    arabicFont: 'الخط العربي',
    fontAmiri: 'أميري',
    fontNaskh: 'نوتو نسخ',
    fontNastaliq: 'نستعليق (هندي)',
    fontScheherazade: 'شهرزاد',
    // Reading mode
    readingMode: 'وضع القراءة',
    paginationMode: 'صفحات',
    scrollMode: 'التمرير المستمر',
    paginationDesc: 'صفحة واحدة في كل مرة',
    scrollDesc: 'تمرير عبر جميع الصفحات',
    // Delete book
    deleteBook: 'حذف الكتاب',
    deleteBookConfirm: 'هل أنت متأكد من حذف هذا الكتاب وجميع بياناته؟',
    bookDeleted: 'تم حذف الكتاب بنجاح',
    // Help
    help: 'المساعدة والدليل',
    userGuide: 'دليل المستخدم',
    userGuideDesc: 'تعرف على كيفية استخدام التطبيق',
    openGuide: 'فتح الدليل',
  },
};

// IndexedDB for persistent storage
const DB_NAME = 'hadithHub';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

// In-memory cache (synced with IndexedDB)
let booksStore: Book[] = [];
let volumesStore: VolumeInfo[] = [];
let pagesStore: Page[] = [];
let savedLanguage: Language = (localStorage.getItem('hadithHub_language') as Language) || 'en';
let savedTheme: Theme = (localStorage.getItem('hadithHub_theme') as Theme) || 'light';
let savedArabicFont: ArabicFont = (localStorage.getItem('hadithHub_arabicFont') as ArabicFont) || 'amiri';
let savedReadingMode: ReadingMode = (localStorage.getItem('hadithHub_readingMode') as ReadingMode) || 'pagination';

// Initialize IndexedDB
function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object stores
      if (!database.objectStoreNames.contains('books')) {
        database.createObjectStore('books', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('volumes')) {
        const volumeStore = database.createObjectStore('volumes', { keyPath: ['bookId', 'volume'] });
        volumeStore.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!database.objectStoreNames.contains('pages')) {
        const pageStore = database.createObjectStore('pages', { keyPath: ['bookId', 'volume', 'page'] });
        pageStore.createIndex('bookId', 'bookId', { unique: false });
        pageStore.createIndex('bookVolume', ['bookId', 'volume'], { unique: false });
      }
    };
  });
}

// Load all data from IndexedDB into memory
async function loadFromDB(): Promise<void> {
  const database = await initDB();

  const loadStore = <T,>(storeName: string): Promise<T[]> => {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  try {
    booksStore = await loadStore<Book>('books');
    volumesStore = await loadStore<VolumeInfo>('volumes');
    pagesStore = await loadStore<Page>('pages');
    console.log(`Loaded from IndexedDB: ${booksStore.length} books, ${volumesStore.length} volumes, ${pagesStore.length} pages`);
  } catch (err) {
    console.error('Failed to load from IndexedDB:', err);
  }
}

// Save a book to IndexedDB
async function saveBookToDB(book: Book): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const request = store.put(book);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Save a volume to IndexedDB
async function saveVolumeToDB(volume: VolumeInfo): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('volumes', 'readwrite');
    const store = tx.objectStore('volumes');
    const request = store.put(volume);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Save pages to IndexedDB (batch)
async function savePagesToDB(pages: Page[]): Promise<void> {
  if (pages.length === 0) return;
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    pages.forEach(page => store.put(page));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Delete pages for a specific volume from IndexedDB
async function deletePagesFromDB(bookId: string, volume: number): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    const index = store.index('bookVolume');
    const request = index.openCursor(IDBKeyRange.only([bookId, volume]));

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clear all data from IndexedDB
async function clearAllFromDB(): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['books', 'volumes', 'pages'], 'readwrite');
    tx.objectStore('books').clear();
    tx.objectStore('volumes').clear();
    tx.objectStore('pages').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Delete a specific book and all its data from IndexedDB
async function deleteBookFromDB(bookId: string): Promise<void> {
  const database = await initDB();

  // Delete book
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('books', 'readwrite');
    tx.objectStore('books').delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Delete all volumes for this book
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('volumes', 'readwrite');
    const store = tx.objectStore('volumes');
    const index = store.index('bookId');
    const request = index.openCursor(IDBKeyRange.only(bookId));

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Delete all pages for this book
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    const index = store.index('bookId');
    const request = index.openCursor(IDBKeyRange.only(bookId));

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Format page text - parse JSON array and format with proper spacing
function formatPageText(rawText: string): string {
  try {
    // Try to parse as JSON array
    const paragraphs = JSON.parse(rawText);
    if (Array.isArray(paragraphs)) {
      return paragraphs.map((p, index) => {
        // Add spacing between paragraphs
        // Detect hadith numbers at start (e.g., "1 -", "2 -", etc.)
        const hadithMatch = p.match(/^(\d+)\s*-/);
        if (hadithMatch && index > 0) {
          // Add extra spacing before hadith numbers
          return '\n' + p;
        }
        return p;
      }).join('\n\n');
    }
    return rawText;
  } catch {
    // Not JSON, return as-is
    return rawText;
  }
}

const styles: Record<string, CSSProperties> = {
  app: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
  },
  // Compact modern header
  header: {
    background: 'var(--card)',
    borderBottom: '1px solid var(--border)',
    padding: '12px 20px',
    paddingTop: 'calc(12px + env(safe-area-inset-top))',
  },
  headerHome: {
    padding: '16px 20px',
    paddingTop: 'calc(16px + env(safe-area-inset-top))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '-0.02em',
  },
  headerSubtitle: {
    fontSize: '0.8rem',
    color: 'var(--text-tertiary)',
    fontWeight: 500,
  },
  headerInner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  backBtn: {
    background: 'var(--border-light)',
    border: 'none',
    borderRadius: '10px',
    padding: '10px',
    color: 'var(--text)',
    cursor: 'pointer',
    display: 'flex',
    transition: 'all 0.15s ease',
  },
  content: {
    flex: 1,
    padding: '16px',
    overflow: 'auto',
  },
  card: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '20px',
    marginBottom: '12px',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--border-light)',
  },
  cardTitle: {
    fontSize: '0.875rem',
    fontWeight: 600,
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  bookCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '16px',
    marginBottom: '10px',
    boxShadow: 'var(--shadow-xs)',
    border: '1px solid var(--border-light)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  bookTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: '2px',
    fontFamily: "'Amiri', serif",
    color: 'var(--text)',
  },
  bookMeta: {
    fontSize: '0.8rem',
    color: 'var(--text-tertiary)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  volumeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '8px',
  },
  volumeBtn: {
    aspectRatio: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--primary-50)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--primary)',
    transition: 'all 0.15s ease',
  },
  btn: {
    padding: '12px 20px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--primary)',
    color: 'white',
    border: 'none',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    transition: 'all 0.15s ease',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  },
  btnSecondary: {
    background: 'var(--card)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    boxShadow: 'none',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1.5px solid var(--border)',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    marginBottom: '12px',
    background: 'var(--card)',
    color: 'var(--text)',
  },
  fileLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '28px 20px',
    border: '2px dashed var(--border)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    textAlign: 'center',
    color: 'var(--text-tertiary)',
    marginBottom: '16px',
    background: 'var(--border-light)',
    transition: 'all 0.2s ease',
  },
  progressBar: {
    height: '6px',
    background: 'var(--border-light)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 100%)',
    transition: 'width 0.3s ease',
    borderRadius: 'var(--radius-full)',
  },
  empty: {
    textAlign: 'center',
    padding: '48px 20px',
    color: 'var(--text-tertiary)',
  },
  // Modern pill-style navigation
  nav: {
    display: 'flex',
    gap: '4px',
    padding: '8px 12px',
    paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
    background: 'var(--card)',
    borderTop: '1px solid var(--border-light)',
  },
  navBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 4px',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-tertiary)',
    gap: '4px',
    fontSize: '0.7rem',
    fontWeight: 500,
    transition: 'all 0.15s ease',
  },
  navBtnActive: {
    background: 'var(--primary)',
    color: 'white',
  },
  textCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px',
    boxShadow: 'var(--shadow-sm)',
    marginBottom: '12px',
    border: '1px solid var(--border-light)',
  },
  arabicText: {
    fontFamily: "'Amiri', serif",
    fontSize: '1.25rem',
    lineHeight: 2.2,
    textAlign: 'right',
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '10px 14px',
    boxShadow: 'var(--shadow-sm)',
    margin: '0 16px 12px',
    gap: '8px',
    border: '1px solid var(--border-light)',
  },
  pageNavBtn: {
    background: 'var(--primary)',
    color: 'white',
    border: 'none',
    borderRadius: 'var(--radius-xs)',
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    minWidth: '70px',
    transition: 'all 0.15s ease',
  },
  pageNavInput: {
    width: '56px',
    padding: '6px 8px',
    borderRadius: 'var(--radius-xs)',
    border: '1.5px solid var(--border)',
    fontSize: '0.9rem',
    textAlign: 'center',
    fontFamily: 'inherit',
    background: 'var(--card)',
  },
  searchModeContainer: {
    display: 'flex',
    gap: '6px',
  },
  searchModeBtn: {
    flex: 1,
    padding: '8px 6px',
    borderRadius: 'var(--radius-xs)',
    border: '1.5px solid var(--border)',
    background: 'var(--card)',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    transition: 'all 0.15s ease',
  },
  searchModeBtnActive: {
    borderColor: 'var(--primary)',
    background: 'var(--primary-50)',
    color: 'var(--primary)',
  },
  compactPageNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '8px 14px',
    background: 'var(--border-light)',
    borderRadius: 'var(--radius-sm)',
    marginTop: '10px',
  },
  compactPageBtn: {
    background: 'var(--primary)',
    color: 'white',
    border: 'none',
    borderRadius: 'var(--radius-xs)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '36px',
    transition: 'all 0.15s ease',
  },
  pageIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  searchOptionsRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '14px',
  },
  searchOptionGroup: {
    flex: 1,
  },
  searchOptionLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    marginBottom: '6px',
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  convertedText: {
    background: 'var(--primary-50)',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: '12px',
    fontSize: '0.9rem',
    color: 'var(--primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  segmentedControl: {
    display: 'flex',
    background: 'var(--border)',
    borderRadius: '8px',
    padding: '3px',
  },
  segmentBtn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    transition: 'all 0.2s ease',
  },
  segmentBtnActive: {
    background: 'var(--card)',
    color: 'var(--primary)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
};

// Responsive styles helper - creates styles based on screen size
const getResponsiveStyles = (isDesktop: boolean, isTablet: boolean): Record<string, CSSProperties> => ({
  // Desktop wrapper with sidebar
  desktopWrapper: {
    display: 'flex',
    minHeight: '100dvh',
    background: 'var(--bg)',
  },
  // Sidebar for desktop
  sidebar: {
    width: isDesktop ? '280px' : '240px',
    background: 'var(--card)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    position: 'sticky',
    top: 0,
    flexShrink: 0,
  },
  sidebarHeader: {
    padding: '24px 20px',
    borderBottom: '1px solid var(--border-light)',
  },
  sidebarNav: {
    flex: 1,
    padding: '16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sidebarNavBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    fontWeight: 500,
    transition: 'all 0.15s ease',
    width: '100%',
    textAlign: 'right',
  },
  sidebarNavBtnActive: {
    background: 'var(--primary)',
    color: 'white',
  },
  sidebarFooter: {
    padding: '16px 20px',
    borderTop: '1px solid var(--border-light)',
    fontSize: '0.75rem',
    color: 'var(--text-tertiary)',
  },
  // Main content area for desktop
  mainContent: {
    flex: 1,
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  // Content container with max-width
  contentContainer: {
    maxWidth: isDesktop ? '900px' : isTablet ? '720px' : '100%',
    margin: '0 auto',
    width: '100%',
    padding: isDesktop ? '24px 32px' : isTablet ? '20px 24px' : '16px',
  },
  // Book grid for larger screens
  bookGrid: {
    display: 'grid',
    gridTemplateColumns: isDesktop ? 'repeat(2, 1fr)' : '1fr',
    gap: isDesktop ? '16px' : '10px',
  },
  // Volume grid responsive
  volumeGridResponsive: {
    display: 'grid',
    gridTemplateColumns: isDesktop ? 'repeat(8, 1fr)' : isTablet ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)',
    gap: isDesktop ? '12px' : '8px',
  },
  // Reader content for larger screens
  readerContent: {
    maxWidth: isDesktop ? '800px' : isTablet ? '680px' : '100%',
    margin: '0 auto',
    width: '100%',
  },
  // Card responsive
  cardResponsive: {
    padding: isDesktop ? '28px' : isTablet ? '24px' : '20px',
  },
  // Text card for reader
  textCardResponsive: {
    padding: isDesktop ? '32px 40px' : isTablet ? '28px 32px' : '24px',
  },
  // Header responsive
  headerResponsive: {
    padding: isDesktop ? '16px 32px' : isTablet ? '14px 24px' : '12px 20px',
    paddingTop: isDesktop ? '16px' : 'calc(12px + env(safe-area-inset-top))',
  },
  // Import book card in grid
  importBookCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: isDesktop ? '20px' : '16px',
    boxShadow: 'var(--shadow-xs)',
    border: '1px solid var(--border-light)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  // Available books grid
  availableBooksGrid: {
    display: 'grid',
    gridTemplateColumns: isDesktop ? 'repeat(2, 1fr)' : '1fr',
    gap: isDesktop ? '16px' : '12px',
  },
  // Search results grid
  searchResultsGrid: {
    display: 'grid',
    gridTemplateColumns: isDesktop ? 'repeat(2, 1fr)' : '1fr',
    gap: isDesktop ? '12px' : '10px',
  },
});

function App() {
  // Responsive hook
  const { isTablet, isDesktop } = useResponsive();
  const responsiveStyles = getResponsiveStyles(isDesktop, isTablet);

  const [view, setView] = useState<ViewType>('home');
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [selectedVolume, setSelectedVolume] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pageText, setPageText] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(GITHUB_DATA_URL);
  const [language, setLanguage] = useState<Language>(savedLanguage);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [fromSearch, setFromSearch] = useState(false);
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [availableBooks, setAvailableBooks] = useState<AvailableBook[]>([]);
  const [availableTranslationBooks, setAvailableTranslationBooks] = useState<AvailableBook[]>([]);
  const [selectedImportBook, setSelectedImportBook] = useState<AvailableBook | null>(null);
  const [availableDownloads, setAvailableDownloads] = useState<AvailableDownload[]>([]);
  const [availableTranslations, setAvailableTranslations] = useState<AvailableDownload[]>([]);
  const [selectedVolumes, setSelectedVolumes] = useState<Set<number>>(new Set());
  const [loadingDownloads, setLoadingDownloads] = useState(false);
  const [downloadingVolumes, setDownloadingVolumes] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('arabic');
  const [searchMode, setSearchMode] = useState<SearchMode>('root');
  const [inputMode, setInputMode] = useState<InputMode>('arabic');
  const [pageInputValue, setPageInputValue] = useState('');
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [arabicFont, setArabicFont] = useState<ArabicFont>(savedArabicFont);
  const [readingMode, setReadingMode] = useState<ReadingMode>(savedReadingMode);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState<string | null>(null);
  const [headerPageInput, setHeaderPageInput] = useState('');
  // Sect filter and book selection for search
  const [searchSectFilter, setSearchSectFilter] = useState<SectFilter>('all');
  const [searchSelectedBooks, setSearchSelectedBooks] = useState<Set<string>>(new Set());
  const [showBookSelector, setShowBookSelector] = useState(false);
  // Import page sect filter
  const [importSectFilter, setImportSectFilter] = useState<SectFilter>('all');
  // Import page language filter
  const [importLanguageFilter, setImportLanguageFilter] = useState<LanguageFilter>('all');
  // Import page search and pagination
  const [importBookSearch, setImportBookSearch] = useState('');
  const [importBooksPage, setImportBooksPage] = useState(1);
  const IMPORT_BOOKS_PER_PAGE = 20;
  // Bulk download state
  const [bulkDownloading, setBulkDownloading] = useState<'shia' | 'sunni' | 'all' | null>(null);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState<{ current: number; total: number; booksCompleted: number } | null>(null);
  // Search pagination
  const [searchResultsPage, setSearchResultsPage] = useState(1);
  const RESULTS_PER_PAGE = 20;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track data version to force re-render when volumes/pages are updated
  const [dataVersion, setDataVersion] = useState(0);

  const t = translations[language];
  const isRTL = language === 'ar';

  function changeLanguage(lang: Language) {
    setLanguage(lang);
    savedLanguage = lang;
    localStorage.setItem('hadithHub_language', lang);
  }

  function changeTheme(newTheme: Theme) {
    setTheme(newTheme);
    savedTheme = newTheme;
    localStorage.setItem('hadithHub_theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  }

  function changeArabicFont(newFont: ArabicFont) {
    setArabicFont(newFont);
    savedArabicFont = newFont;
    localStorage.setItem('hadithHub_arabicFont', newFont);
  }

  function changeReadingMode(newMode: ReadingMode) {
    setReadingMode(newMode);
    savedReadingMode = newMode;
    localStorage.setItem('hadithHub_readingMode', newMode);
  }

  // Get the current Arabic font family CSS value
  const arabicFontFamily = ARABIC_FONTS[arabicFont].family;

  // Apply theme on initial load
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    // Load data from IndexedDB on startup
    loadFromDB().then(() => {
      setBooks([...booksStore]);
      setDataVersion(1); // Initialize dataVersion to trigger translation availability check
    }).catch(err => {
      console.error('Failed to load data:', err);
    });
  }, []);

  // Auto-fetch available books from GitHub when import view is opened
  useEffect(() => {
    if (view === 'import' && availableBooks.length === 0 && !loadingDownloads) {
      fetchAvailableDownloads();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function fetchAvailableDownloads() {
    setLoadingDownloads(true);
    try {
      // Determine the data source URL
      const dataUrl = serverUrl.trim() || GITHUB_DATA_URL;
      const isGitHub = dataUrl.includes('raw.githubusercontent.com');

      // For GitHub, fetch books.json; for custom server, fetch /downloads
      const endpoint = isGitHub ? `${dataUrl}/books.json` : `${dataUrl}/downloads`;
      const res = await fetch(endpoint);

      if (res.ok) {
        const data = await res.json();

        // GitHub format: transform to app's expected format
        if (isGitHub && data.books && data.baseUrl) {
          const transformedBooks: AvailableBook[] = data.books.map((book: {
            slug: string;
            id: string;
            titleAr: string;
            titleEn: string;
            authorAr: string;
            authorEn: string;
            sect: string;
            language: 'ar' | 'fa' | 'en';
            volumes: Array<{ volume: number; filename: string; size: number; sizeFormatted: string }>;
            totalVolumes: number;
          }) => ({
            slug: book.slug,
            bookId: book.id,
            bookTitle: book.titleAr,
            bookTitleAr: book.titleAr,
            bookTitleEn: book.titleEn,
            author: book.authorAr,
            authorAr: book.authorAr,
            authorEn: book.authorEn,
            sect: book.sect,
            bookLanguage: book.language || 'ar',
            total: book.totalVolumes,
            downloads: book.volumes.map(v => ({
              filename: v.filename,
              volume: v.volume,
              size: v.size,
              sizeFormatted: v.sizeFormatted,
              downloadUrl: `${data.baseUrl}/books/${v.filename}`,
              bookId: book.id,
              bookTitle: book.titleAr,
              language: book.language || 'ar'
            }))
          }));

          const transformedTranslations: AvailableBook[] = (data.translations || []).map((book: {
            slug: string;
            id: string;
            sourceId: string;
            titleAr: string;
            titleEn: string;
            authorAr: string;
            authorEn: string;
            sect: string;
            volumes: Array<{ volume: number; filename: string; size: number; sizeFormatted: string }>;
            totalVolumes: number;
          }) => ({
            slug: book.slug,
            bookId: book.id,
            sourceBookId: book.sourceId,
            bookTitle: book.titleEn,
            bookTitleAr: book.titleAr,
            bookTitleEn: book.titleEn,
            author: book.authorEn || book.authorAr,
            authorAr: book.authorAr,
            authorEn: book.authorEn,
            sect: book.sect,
            total: book.totalVolumes,
            downloads: book.volumes.map(v => ({
              filename: v.filename,
              volume: v.volume,
              size: v.size,
              sizeFormatted: v.sizeFormatted,
              downloadUrl: `${data.baseUrl}/translations/${v.filename}`,
              bookId: book.id,
              bookTitle: book.titleEn,
              language: 'en'
            }))
          }));

          setAvailableBooks(transformedBooks);
          setAvailableTranslationBooks(transformedTranslations);

          // Auto-select first book if available
          if (transformedBooks.length > 0 && !selectedImportBook) {
            const firstBook = transformedBooks[0];
            setSelectedImportBook(firstBook);
            setAvailableDownloads(firstBook.downloads || []);

            // Find matching translations
            const matchingTranslations = transformedTranslations.find(
              t => t.sourceBookId === firstBook.bookId || t.slug === firstBook.slug
            );
            setAvailableTranslations(matchingTranslations?.downloads || []);
          }
        }
        // Server format: check if multi-book or single-book
        else if (data.books && Array.isArray(data.books)) {
          // Multi-book format
          setAvailableBooks(data.books);
          setAvailableTranslationBooks(data.translations || []);

          // Auto-select first book if available
          if (data.books.length > 0 && !selectedImportBook) {
            const firstBook = data.books[0];
            setSelectedImportBook(firstBook);
            setAvailableDownloads(firstBook.downloads || []);

            // Find matching translations
            const matchingTranslations = (data.translations || []).find(
              (t: AvailableBook) => t.sourceBookId === firstBook.bookId || t.slug === firstBook.slug
            );
            setAvailableTranslations(matchingTranslations?.downloads || []);
          }
        } else {
          // Single-book format (backwards compatible)
          const singleBook: AvailableBook = {
            slug: 'bihar-anwar',
            bookId: data.bookId || '01407',
            bookTitle: data.bookTitle || 'بحار الأنوار',
            bookTitleEn: 'Bihar al-Anwar',
            author: 'العلامة المجلسي',
            total: data.total || 0,
            downloads: data.downloads || []
          };
          setAvailableBooks([singleBook]);
          setSelectedImportBook(singleBook);
          setAvailableDownloads(data.downloads || []);

          // Handle translations
          if (data.translations) {
            const translationBook: AvailableBook = {
              slug: 'bihar-anwar',
              bookId: data.translations.bookId || '01407_en',
              bookTitle: data.translations.bookTitle || 'Bihar al-Anwar (English)',
              author: 'العلامة المجلسي',
              total: data.translations.total || 0,
              downloads: data.translations.downloads || []
            };
            setAvailableTranslationBooks([translationBook]);
            setAvailableTranslations(data.translations.downloads || []);
          }
        }
      } else {
        setAvailableBooks([]);
        setAvailableTranslationBooks([]);
        setAvailableDownloads([]);
        setAvailableTranslations([]);
      }
    } catch (err) {
      console.error('Failed to fetch downloads:', err);
      setAvailableBooks([]);
      setAvailableTranslationBooks([]);
      setAvailableDownloads([]);
      setAvailableTranslations([]);
    } finally {
      setLoadingDownloads(false);
    }
  }

  function selectImportBook(book: AvailableBook) {
    setSelectedImportBook(book);
    setAvailableDownloads(book.downloads || []);
    setSelectedVolumes(new Set());

    // Find matching translations for this book
    const matchingTranslations = availableTranslationBooks.find(
      t => t.bookId === book.bookId + '_en' || t.slug === book.slug
    );
    setAvailableTranslations(matchingTranslations?.downloads || []);
  }

  function toggleVolumeSelection(volume: number) {
    setSelectedVolumes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(volume)) {
        newSet.delete(volume);
      } else {
        newSet.add(volume);
      }
      return newSet;
    });
  }

  function selectAllVolumes() {
    const downloads = importMode === 'english' ? availableTranslations : availableDownloads;
    setSelectedVolumes(new Set(downloads.map(d => d.volume)));
  }

  function deselectAllVolumes() {
    setSelectedVolumes(new Set());
  }

  async function downloadSelectedVolumes() {
    if (selectedVolumes.size === 0) return;

    setDownloadingVolumes(true);
    const downloads = importMode === 'english' ? availableTranslations : availableDownloads;
    const volumesToDownload = downloads.filter(d => selectedVolumes.has(d.volume));
    let successCount = 0;

    for (let i = 0; i < volumesToDownload.length; i++) {
      const dl = volumesToDownload[i];
      setDownloadProgress({ current: i + 1, total: volumesToDownload.length });

      try {
        // Download the ZIP file (downloadUrl may be absolute for GitHub or relative for custom server)
        const downloadUrl = dl.downloadUrl.startsWith('http') ? dl.downloadUrl : `${serverUrl}${dl.downloadUrl}`;
        const res = await fetch(downloadUrl);
        if (!res.ok) continue;

        const blob = await res.blob();
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(blob);

        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) continue;

        const manifest = JSON.parse(await manifestFile.async('text'));

        // Import pages
        for (const volInfo of manifest.volumes) {
          const pages: Page[] = [];
          for (let p = 1; p <= volInfo.totalPages; p++) {
            const pageFile = zip.file(`volumes/${volInfo.volume}/${p}.txt`);
            if (pageFile) {
              const text = await pageFile.async('text');
              pages.push({ bookId: manifest.id, volume: volInfo.volume, page: p, text });
            }
          }
          // Remove existing pages for this volume from memory
          pagesStore = pagesStore.filter(pg => !(pg.bookId === manifest.id && pg.volume === volInfo.volume));
          pagesStore = [...pagesStore, ...pages];

          // Remove existing pages from IndexedDB and save new ones
          await deletePagesFromDB(manifest.id, volInfo.volume);
          await savePagesToDB(pages);

          // Update volumes store
          volumesStore = volumesStore.filter(v => !(v.bookId === manifest.id && v.volume === volInfo.volume));
          const newVolume = { bookId: manifest.id, volume: volInfo.volume, totalPages: volInfo.totalPages, importedAt: Date.now() };
          volumesStore.push(newVolume);
          await saveVolumeToDB(newVolume);
        }

        // Add/update book (for translations, this creates a separate _en book entry)
        const maxVolume = Math.max(...manifest.volumes.map((v: { volume: number }) => v.volume));
        const existingBook = booksStore.find(b => b.id === manifest.id);
        if (existingBook) {
          existingBook.volumes = Math.max(existingBook.volumes, maxVolume);
          await saveBookToDB(existingBook);
        } else {
          const newBook = { id: manifest.id, title: manifest.title, author: manifest.author, volumes: maxVolume, importedAt: Date.now() };
          booksStore.push(newBook);
          await saveBookToDB(newBook);
        }

        successCount++;
      } catch (err) {
        console.error(`Failed to download volume ${dl.volume}:`, err);
      }
    }

    setBooks([...booksStore]);
    setSelectedVolumes(new Set());
    setDataVersion(v => v + 1); // Trigger re-render to update translation availability
    showToast(`${t.downloadSuccess}: ${successCount}/${volumesToDownload.length}`);
    setDownloadingVolumes(false);
    setDownloadProgress(null);
  }

  // Bulk download all books of a specific sect or all books
  async function downloadAllBySect(sect: 'shia' | 'sunni' | 'all') {
    if (bulkDownloading) return;

    // Filter books by sect or get all
    const booksToDownload = sect === 'all'
      ? availableBooks
      : availableBooks.filter(book => getBookSect(book.bookId) === sect);
    if (booksToDownload.length === 0) {
      showToast('No books available');
      return;
    }

    setBulkDownloading(sect);
    let totalVolumes = 0;
    let completedVolumes = 0;
    let booksCompleted = 0;

    // Calculate total volumes
    for (const book of booksToDownload) {
      totalVolumes += book.downloads.length;
    }

    setBulkDownloadProgress({ current: 0, total: totalVolumes, booksCompleted: 0 });

    for (const book of booksToDownload) {
      for (const dl of book.downloads) {
        try {
          // Download the ZIP file (downloadUrl may be absolute for GitHub or relative for custom server)
          const downloadUrl = dl.downloadUrl.startsWith('http') ? dl.downloadUrl : `${serverUrl}${dl.downloadUrl}`;
          const res = await fetch(downloadUrl);
          if (!res.ok) {
            completedVolumes++;
            setBulkDownloadProgress({ current: completedVolumes, total: totalVolumes, booksCompleted });
            continue;
          }

          const blob = await res.blob();
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(blob);

          const manifestFile = zip.file('manifest.json');
          if (!manifestFile) {
            completedVolumes++;
            setBulkDownloadProgress({ current: completedVolumes, total: totalVolumes, booksCompleted });
            continue;
          }

          const manifest = JSON.parse(await manifestFile.async('text'));

          // Import pages
          for (const volInfo of manifest.volumes) {
            const pages: Page[] = [];
            for (let p = 1; p <= volInfo.totalPages; p++) {
              const pageFile = zip.file(`volumes/${volInfo.volume}/${p}.txt`);
              if (pageFile) {
                const text = await pageFile.async('text');
                pages.push({ bookId: manifest.id, volume: volInfo.volume, page: p, text });
              }
            }
            // Remove existing pages for this volume from memory
            pagesStore = pagesStore.filter(pg => !(pg.bookId === manifest.id && pg.volume === volInfo.volume));
            pagesStore = [...pagesStore, ...pages];

            // Remove existing pages from IndexedDB and save new ones
            await deletePagesFromDB(manifest.id, volInfo.volume);
            await savePagesToDB(pages);

            // Update volumes store
            volumesStore = volumesStore.filter(v => !(v.bookId === manifest.id && v.volume === volInfo.volume));
            const newVolume = { bookId: manifest.id, volume: volInfo.volume, totalPages: volInfo.totalPages, importedAt: Date.now() };
            volumesStore.push(newVolume);
            await saveVolumeToDB(newVolume);
          }

          // Add/update book
          const maxVolume = Math.max(...manifest.volumes.map((v: { volume: number }) => v.volume));
          const existingBook = booksStore.find(b => b.id === manifest.id);
          if (existingBook) {
            existingBook.volumes = Math.max(existingBook.volumes, maxVolume);
            await saveBookToDB(existingBook);
          } else {
            const newBook = { id: manifest.id, title: manifest.title, author: manifest.author, volumes: maxVolume, importedAt: Date.now() };
            booksStore.push(newBook);
            await saveBookToDB(newBook);
          }

          completedVolumes++;
          setBulkDownloadProgress({ current: completedVolumes, total: totalVolumes, booksCompleted });
        } catch (err) {
          console.error(`Failed to download volume ${dl.volume} of ${book.bookTitle}:`, err);
          completedVolumes++;
          setBulkDownloadProgress({ current: completedVolumes, total: totalVolumes, booksCompleted });
        }
      }
      booksCompleted++;
      setBulkDownloadProgress({ current: completedVolumes, total: totalVolumes, booksCompleted });
    }

    setBooks([...booksStore]);
    setDataVersion(v => v + 1); // Trigger re-render to update translation availability
    showToast(`${t.downloadSuccess}: ${booksCompleted} ${t.booksDownloaded}`);
    setBulkDownloading(null);
    setBulkDownloadProgress(null);
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);

      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        showToast(t.manifestNotFound);
        return;
      }

      const manifest = JSON.parse(await manifestFile.async('text'));

      // Import pages
      for (const volInfo of manifest.volumes) {
        const pages: Page[] = [];
        for (let i = 1; i <= volInfo.totalPages; i++) {
          const pageFile = zip.file(`volumes/${volInfo.volume}/${i}.txt`);
          if (pageFile) {
            const text = await pageFile.async('text');
            pages.push({ bookId: manifest.id, volume: volInfo.volume, page: i, text });
          }
        }
        // Update memory store
        pagesStore = [...pagesStore.filter(pg => !(pg.bookId === manifest.id && pg.volume === volInfo.volume)), ...pages];
        volumesStore = volumesStore.filter(v => !(v.bookId === manifest.id && v.volume === volInfo.volume));
        const newVolume = { bookId: manifest.id, volume: volInfo.volume, totalPages: volInfo.totalPages, importedAt: Date.now() };
        volumesStore.push(newVolume);

        // Persist to IndexedDB
        await deletePagesFromDB(manifest.id, volInfo.volume);
        await savePagesToDB(pages);
        await saveVolumeToDB(newVolume);
      }

      // Add book - track actual volume numbers, not count
      const existingBook = booksStore.find(b => b.id === manifest.id);
      const maxVolume = Math.max(...manifest.volumes.map((v: { volume: number }) => v.volume));
      if (existingBook) {
        existingBook.volumes = Math.max(existingBook.volumes, maxVolume);
        await saveBookToDB(existingBook);
      } else {
        const newBook = { id: manifest.id, title: manifest.title, author: manifest.author, volumes: maxVolume, importedAt: Date.now() };
        booksStore.push(newBook);
        await saveBookToDB(newBook);
      }
      setBooks([...booksStore]);
      setDataVersion(v => v + 1); // Trigger re-render to update translation availability
      showToast(t.importSuccess);
    } catch (err) {
      console.error('Import failed:', err);
      showToast(t.importFailed);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleBookSelect(book: Book) {
    setSelectedBook(book);
    const vols = volumesStore.filter(v => v.bookId === book.id);
    setVolumes(vols);
    setView('library');
  }

  async function handleDeleteBook(book: Book) {
    if (!confirm(t.deleteBookConfirm)) return;

    // Also delete any associated translation book
    const translationBookId = `${book.id}_en`;

    // Remove from memory stores
    booksStore = booksStore.filter(b => b.id !== book.id && b.id !== translationBookId);
    volumesStore = volumesStore.filter(v => v.bookId !== book.id && v.bookId !== translationBookId);
    pagesStore = pagesStore.filter(p => p.bookId !== book.id && p.bookId !== translationBookId);

    // Delete from IndexedDB
    await deleteBookFromDB(book.id);
    await deleteBookFromDB(translationBookId);

    // Update React state
    setBooks([...booksStore]);
    setSelectedBook(null);
    setVolumes([]);
    setDataVersion(v => v + 1);
    setView('home');
    showToast(t.bookDeleted);
  }

  function handleVolumeSelect(vol: number) {
    if (!selectedBook) return;
    const volInfo = volumesStore.find(v => v.bookId === selectedBook.id && v.volume === vol);
    if (volInfo) {
      setSelectedVolume(vol);
      setTotalPages(volInfo.totalPages);
      setCurrentPage(1);
      loadPage(selectedBook.id, vol, 1);
      setView('reader');
    }
  }

  function loadPage(bookId: string, volume: number, page: number) {
    const p = pagesStore.find(pg => pg.bookId === bookId && pg.volume === volume && pg.page === page);
    if (p?.text) {
      setPageText(formatPageText(p.text));
    } else {
      setPageText(t.pageNotAvailable);
    }
  }

  function goToPage(page: number) {
    if (!selectedBook || !selectedVolume) return;
    setCurrentPage(page);
    loadPage(selectedBook.id, selectedVolume, page);
  }

  function performSearch(query: string) {
    if (!query.trim()) return;

    setIsSearching(true);
    setSavedSearchQuery(query);
    setSearchResultsPage(1); // Reset to first page

    // Search in all pages
    const results: SearchResult[] = [];
    let searchTerm = query.trim();

    // Convert Roman to Arabic if in roman input mode
    if (inputMode === 'roman') {
      searchTerm = romanToArabic(searchTerm);
    }

    // Normalize search term for root matching
    const normalizedSearchTerm = searchMode === 'root' ? normalizeArabic(searchTerm) : searchTerm;

    // Filter pages based on sect and book selection
    const filteredPages = pagesStore.filter(page => {
      // Filter by sect
      if (searchSectFilter !== 'all') {
        const bookSect = getBookSect(page.bookId);
        if (bookSect !== searchSectFilter) return false;
      }
      // Filter by selected books (if any selected)
      if (searchSelectedBooks.size > 0 && !searchSelectedBooks.has(page.bookId)) {
        return false;
      }
      return true;
    });

    for (const page of filteredPages) {
      // Get the formatted text for searching
      let textToSearch = page.text;
      try {
        const parsed = JSON.parse(page.text);
        if (Array.isArray(parsed)) {
          textToSearch = parsed.join(' ');
        }
      } catch {
        // Use as-is
      }

      // Normalize text for root matching (always normalize for better Arabic matching)
      const textForMatching = searchMode === 'root' ? normalizeArabic(textToSearch) : textToSearch;

      // Use indexOf directly for Arabic text
      let searchIndex = 0;
      let matchCount = 0;

      while ((searchIndex = textForMatching.indexOf(normalizedSearchTerm, searchIndex)) !== -1) {
        // Get surrounding context (snippet) - use original text for display
        const start = Math.max(0, searchIndex - 50);
        const end = Math.min(textToSearch.length, searchIndex + normalizedSearchTerm.length + 50);
        let snippet = textToSearch.substring(start, end);

        // Add ellipsis if truncated
        if (start > 0) snippet = '...' + snippet;
        if (end < textToSearch.length) snippet = snippet + '...';

        // Find book title
        const book = booksStore.find(b => b.id === page.bookId);

        results.push({
          bookId: page.bookId,
          bookTitle: book?.title || page.bookId,
          volume: page.volume,
          page: page.page,
          snippet,
          matchIndex: matchCount,
        });

        searchIndex += normalizedSearchTerm.length;
        matchCount++;

        // Limit matches per page to avoid duplicates
        if (matchCount >= 3) break;
      }
    }

    setSearchResults(results);
    setIsSearching(false);
    setView('searchResults');
  }

  function goToSearchResult(result: SearchResult) {
    const book = booksStore.find(b => b.id === result.bookId);
    if (!book) return;

    setSelectedBook(book);
    setSelectedVolume(result.volume);

    const volInfo = volumesStore.find(v => v.bookId === result.bookId && v.volume === result.volume);
    if (volInfo) {
      setTotalPages(volInfo.totalPages);
    }

    setCurrentPage(result.page);
    loadPage(result.bookId, result.volume, result.page);
    setFromSearch(true);
    setView('reader');
  }

  function backToSearchResults() {
    setFromSearch(false);
    setView('searchResults');
  }

  // Check if translation exists for current volume (used in Reader view)
  const translationBookId = selectedBook ? `${selectedBook.id}_en` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasTranslationForVolume = useMemo(() => {
    if (!selectedBook || !selectedVolume) return false;
    return volumesStore.some(v => v.bookId === translationBookId && v.volume === selectedVolume);
  }, [selectedBook, selectedVolume, translationBookId, dataVersion]);

  // Load translation when page changes
  useEffect(() => {
    if (view === 'reader' && selectedBook && selectedVolume && showTranslation && hasTranslationForVolume) {
      const translationPage = pagesStore.find(
        pg => pg.bookId === translationBookId && pg.volume === selectedVolume && pg.page === currentPage
      );
      if (translationPage?.text) {
        setTranslationText(formatPageText(translationPage.text));
      } else {
        setTranslationText(null);
      }
    } else if (!hasTranslationForVolume) {
      setTranslationText(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentPage, selectedVolume, showTranslation, hasTranslationForVolume, selectedBook, translationBookId, dataVersion]);

  // Reader View
  if (view === 'reader' && selectedBook && selectedVolume) {
    const handlePageInputSubmit = (inputValue: string, setInputValue: (val: string) => void) => {
      const pageNum = parseInt(inputValue);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        goToPage(pageNum);
        setInputValue('');
      }
    };

    // Get all pages for this volume (for scroll mode)
    const getAllVolumePages = () => {
      return pagesStore
        .filter(pg => pg.bookId === selectedBook.id && pg.volume === selectedVolume)
        .sort((a, b) => a.page - b.page);
    };

    // Get translation for a specific page
    const getTranslationForPage = (pageNum: number) => {
      const translationPage = pagesStore.find(
        pg => pg.bookId === translationBookId && pg.volume === selectedVolume && pg.page === pageNum
      );
      return translationPage?.text ? formatPageText(translationPage.text) : null;
    };

    // Page navigation component - only for pagination mode
    const PageNavigation = ({ variant = 'bottom' }: { variant?: 'header' | 'bottom' }) => {
      const isHeader = variant === 'header';
      const inputValue = isHeader ? headerPageInput : pageInputValue;
      const setInputValue = isHeader ? setHeaderPageInput : setPageInputValue;

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isHeader ? 'rgba(255,255,255,0.1)' : 'var(--card)',
          borderRadius: '12px',
          padding: isHeader ? '10px 12px' : '12px 16px',
          margin: isHeader ? '12px 0 0' : '0 16px 16px',
          gap: '8px',
          boxShadow: isHeader ? 'none' : 'var(--shadow)',
        }}>
          <button
            style={{
              background: isHeader ? 'rgba(255,255,255,0.2)' : 'var(--primary)',
              color: isHeader ? 'white' : 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              minWidth: '40px',
              opacity: currentPage > 1 ? 1 : 0.4,
            }}
            onClick={() => currentPage > 1 && goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            {isRTL ? '→' : '←'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, justifyContent: 'center' }}>
            <input
              type="number"
              style={{
                width: '50px',
                padding: '6px 4px',
                borderRadius: '6px',
                border: isHeader ? '1px solid rgba(255,255,255,0.3)' : '1px solid var(--border)',
                fontSize: '0.9rem',
                textAlign: 'center',
                fontFamily: 'inherit',
                background: isHeader ? 'rgba(255,255,255,0.15)' : 'var(--card)',
                color: isHeader ? 'white' : 'var(--text)',
              }}
              placeholder={String(currentPage)}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePageInputSubmit(inputValue, setInputValue)}
              min={1}
              max={totalPages}
            />
            <span style={{ fontSize: '0.85rem', color: isHeader ? 'rgba(255,255,255,0.9)' : 'var(--text-secondary)' }}>
              {t.of} {totalPages}
            </span>
            {inputValue && (
              <button
                style={{
                  background: isHeader ? 'rgba(255,255,255,0.2)' : 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                }}
                onClick={() => handlePageInputSubmit(inputValue, setInputValue)}
              >
                {t.goToPage}
              </button>
            )}
          </div>

          <button
            style={{
              background: isHeader ? 'rgba(255,255,255,0.2)' : 'var(--primary)',
              color: isHeader ? 'white' : 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              minWidth: '40px',
              opacity: currentPage < totalPages ? 1 : 0.4,
            }}
            onClick={() => currentPage < totalPages && goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            {isRTL ? '←' : '→'}
          </button>
        </div>
      )
    };

    // Continuous Scroll Mode
    if (readingMode === 'scroll') {
      const allPages = getAllVolumePages();

      // Reader scroll header component (shared between desktop and mobile)
      const ReaderScrollHeader = ({ isDesktopStyle = false }: { isDesktopStyle?: boolean }) => (
        <header style={{
          ...styles.header,
          paddingBottom: '12px',
          ...(isDesktopStyle ? {
            position: 'sticky',
            top: 0,
            zIndex: 100,
            maxWidth: 'var(--reader-max-width)',
            margin: '0 auto',
            borderRadius: '0 0 16px 16px',
          } : {}),
        }}>
          <div style={styles.headerInner}>
            <button style={styles.backBtn} onClick={() => {
              if (fromSearch) {
                backToSearchResults();
              } else {
                setView('library');
              }
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={isRTL ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
              </svg>
            </button>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: isDesktopStyle ? '1.25rem' : '1.1rem', fontWeight: 600, margin: 0 }}>
                {hasBookMetadata(selectedBook.id) ? getBookDisplayName(selectedBook.id, language).title : selectedBook.title}
              </h1>
              <p style={{ fontSize: '0.85rem', opacity: 0.9, margin: 0 }}>
                {fromSearch ? t.backToResults : `${t.volume} ${selectedVolume} • ${totalPages} ${t.pages}`}
              </p>
            </div>
            {/* Translation toggle in header for scroll mode */}
            {hasTranslationForVolume && (
              <button
                onClick={() => setShowTranslation(!showTranslation)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: isDesktopStyle ? '8px 14px' : '6px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: showTranslation ? 'rgba(59, 130, 246, 0.9)' : 'rgba(255,255,255,0.2)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: isDesktopStyle ? '0.85rem' : '0.75rem',
                  fontWeight: 500,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 8l6 6M4 14l6-6 2 2M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6" />
                </svg>
                EN
              </button>
            )}
          </div>
        </header>
      );

      // Page card component (shared between desktop and mobile)
      const PageCard = ({ pg, idx, totalCount, isDesktopStyle = false }: { pg: typeof allPages[0], idx: number, totalCount: number, isDesktopStyle?: boolean }) => {
        const formattedText = formatPageText(pg.text);
        const translationForPage = hasTranslationForVolume && showTranslation ? getTranslationForPage(pg.page) : null;

        return (
          <div
            key={pg.page}
            id={`page-${pg.page}`}
            style={{
              ...styles.textCard,
              marginBottom: idx < totalCount - 1 ? (isDesktopStyle ? '24px' : '16px') : 0,
              ...(isDesktopStyle ? { padding: '32px', borderRadius: '16px' } : {}),
            }}
          >
            {/* Page header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: isDesktopStyle ? '16px' : '12px',
              paddingBottom: isDesktopStyle ? '14px' : '10px',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{
                background: 'var(--primary-50)',
                color: 'var(--primary)',
                padding: isDesktopStyle ? '6px 16px' : '4px 12px',
                borderRadius: '20px',
                fontSize: isDesktopStyle ? '0.9rem' : '0.8rem',
                fontWeight: 600,
              }}>
                {t.page} {pg.page}
              </span>
            </div>

            {/* Arabic text */}
            <div style={{
              ...styles.arabicText,
              fontFamily: arabicFontFamily,
              ...(isDesktopStyle ? { fontSize: '1.3rem', lineHeight: 2.2 } : {}),
            }}>
              {formattedText}
            </div>

            {/* English translation (if enabled) */}
            {translationForPage && (
              <div style={{
                marginTop: isDesktopStyle ? '28px' : '20px',
                paddingTop: isDesktopStyle ? '28px' : '20px',
                borderTop: '2px solid #3b82f6',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: isDesktopStyle ? '16px' : '12px',
                }}>
                  <span style={{
                    background: '#3b82f6',
                    color: 'white',
                    padding: isDesktopStyle ? '4px 12px' : '3px 10px',
                    borderRadius: '4px',
                    fontSize: isDesktopStyle ? '0.85rem' : '0.75rem',
                    fontWeight: 700,
                  }}>
                    EN
                  </span>
                </div>
                <div style={{
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: isDesktopStyle ? '1.1rem' : '1rem',
                  lineHeight: isDesktopStyle ? 2 : 1.8,
                  textAlign: 'left',
                  direction: 'ltr',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {translationForPage}
                </div>
              </div>
            )}
          </div>
        );
      };

      // Desktop Scroll Mode
      if (isDesktop) {
        return (
          <div style={{
            minHeight: '100vh',
            background: 'var(--bg)',
            direction: isRTL ? 'rtl' : 'ltr',
          }}>
            <ReaderScrollHeader isDesktopStyle={true} />

            <div style={{
              maxWidth: 'var(--reader-max-width)',
              margin: '0 auto',
              padding: '24px 32px 60px',
            }}>
              {allPages.map((pg, idx) => (
                <PageCard key={pg.page} pg={pg} idx={idx} totalCount={allPages.length} isDesktopStyle={true} />
              ))}
            </div>
          </div>
        );
      }

      // Mobile/Tablet Scroll Mode
      return (
        <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
          <ReaderScrollHeader isDesktopStyle={false} />

          <div style={{
            ...styles.content,
            paddingBottom: '80px',
            paddingTop: '8px',
          }}>
            {allPages.map((pg, idx) => (
              <PageCard key={pg.page} pg={pg} idx={idx} totalCount={allPages.length} isDesktopStyle={false} />
            ))}
          </div>

          <Nav view={view} onNavigate={setView} t={t} />
        </div>
      );
    }

    // Desktop Pagination Mode navigation component
    const DesktopPageNavigation = () => {
      const inputValue = pageInputValue;
      const setInputValue = setPageInputValue;

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--card)',
          borderRadius: '12px',
          padding: '16px 24px',
          gap: '16px',
          boxShadow: 'var(--shadow)',
          maxWidth: 'var(--reader-max-width)',
          margin: '0 auto 24px',
        }}>
          <button
            style={{
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 500,
              minWidth: '120px',
              opacity: currentPage > 1 ? 1 : 0.4,
              transition: 'all 0.15s ease',
            }}
            onClick={() => currentPage > 1 && goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            {isRTL ? '→' : '←'} {t.previousPage}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              type="number"
              style={{
                width: '70px',
                padding: '10px 8px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                fontSize: '1rem',
                textAlign: 'center',
                fontFamily: 'inherit',
                background: 'var(--card)',
                color: 'var(--text)',
              }}
              placeholder={String(currentPage)}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePageInputSubmit(inputValue, setInputValue)}
              min={1}
              max={totalPages}
            />
            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
              {t.of} {totalPages}
            </span>
            {inputValue && (
              <button
                style={{
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}
                onClick={() => handlePageInputSubmit(inputValue, setInputValue)}
              >
                {t.goToPage}
              </button>
            )}
          </div>

          <button
            style={{
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 500,
              minWidth: '120px',
              opacity: currentPage < totalPages ? 1 : 0.4,
              transition: 'all 0.15s ease',
            }}
            onClick={() => currentPage < totalPages && goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            {t.nextPage} {isRTL ? '←' : '→'}
          </button>
        </div>
      );
    };

    // Desktop Pagination Mode
    if (isDesktop) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          direction: isRTL ? 'rtl' : 'ltr',
        }}>
          {/* Desktop Reader Header */}
          <header style={{
            ...styles.header,
            position: 'sticky',
            top: 0,
            zIndex: 100,
            maxWidth: 'var(--reader-max-width)',
            margin: '0 auto',
            borderRadius: '0 0 16px 16px',
            paddingBottom: '16px',
          }}>
            <div style={styles.headerInner}>
              <button style={styles.backBtn} onClick={() => {
                if (fromSearch) {
                  backToSearchResults();
                } else {
                  setView('library');
                }
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d={isRTL ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
                </svg>
              </button>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                  {hasBookMetadata(selectedBook.id) ? getBookDisplayName(selectedBook.id, language).title : selectedBook.title}
                </h1>
                <p style={{ fontSize: '0.9rem', opacity: 0.9, margin: 0 }}>
                  {fromSearch ? t.backToResults : `${t.volume} ${selectedVolume}`}
                </p>
              </div>
            </div>
          </header>

          {/* Desktop Page Navigation - Top */}
          <div style={{ padding: '24px 32px 0' }}>
            <DesktopPageNavigation />
          </div>

          {/* Desktop Content */}
          <div style={{
            maxWidth: 'var(--reader-max-width)',
            margin: '0 auto',
            padding: '0 32px 60px',
          }}>
            <div style={{
              ...styles.textCard,
              padding: '32px',
              borderRadius: '16px',
            }}>
              {/* Translation toggle button - only show if translation available for this volume */}
              {hasTranslationForVolume && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginBottom: '16px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <button
                    onClick={() => setShowTranslation(!showTranslation)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 18px',
                      borderRadius: '8px',
                      border: 'none',
                      background: showTranslation ? '#3b82f6' : 'var(--border)',
                      color: showTranslation ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: 500,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 8l6 6M4 14l6-6 2 2M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6" />
                    </svg>
                    {showTranslation ? t.hideTranslation : t.showTranslation}
                  </button>
                </div>
              )}

              {/* Arabic text */}
              <div style={{
                ...styles.arabicText,
                fontFamily: arabicFontFamily,
                fontSize: '1.3rem',
                lineHeight: 2.2,
              }}>
                {pageText}
              </div>

              {/* English translation (if enabled and available) */}
              {hasTranslationForVolume && showTranslation && (
                <div style={{
                  marginTop: '28px',
                  paddingTop: '28px',
                  borderTop: '2px solid #3b82f6',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '16px',
                  }}>
                    <span style={{
                      background: '#3b82f6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                    }}>
                      EN
                    </span>
                    <span style={{
                      fontSize: '0.95rem',
                      color: '#3b82f6',
                      fontWeight: 600,
                    }}>
                      {t.englishTranslation}
                    </span>
                  </div>
                  {translationText ? (
                    <div style={{
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      fontSize: '1.1rem',
                      lineHeight: 2,
                      textAlign: 'left',
                      direction: 'ltr',
                      color: 'var(--text)',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {translationText}
                    </div>
                  ) : (
                    <div style={{
                      textAlign: 'center',
                      padding: '30px',
                      color: 'var(--text-secondary)',
                      fontStyle: 'italic',
                      fontSize: '1rem',
                    }}>
                      {t.noTranslation}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Desktop Page Navigation - Bottom */}
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'var(--bg)',
            padding: '16px 32px',
            borderTop: '1px solid var(--border)',
          }}>
            <DesktopPageNavigation />
          </div>
        </div>
      );
    }

    // Mobile/Tablet Pagination Mode (default)
    return (
      <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
        <header style={{ ...styles.header, paddingBottom: '16px' }}>
          <div style={styles.headerInner}>
            <button style={styles.backBtn} onClick={() => {
              if (fromSearch) {
                backToSearchResults();
              } else {
                setView('library');
              }
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={isRTL ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
              </svg>
            </button>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>{hasBookMetadata(selectedBook.id) ? getBookDisplayName(selectedBook.id, language).title : selectedBook.title}</h1>
              <p style={{ fontSize: '0.85rem', opacity: 0.9, margin: 0 }}>
                {fromSearch ? t.backToResults : `${t.volume} ${selectedVolume}`}
              </p>
            </div>
          </div>
          {/* Header page navigation - same as bottom */}
          <PageNavigation variant="header" />
        </header>

        <div style={{ ...styles.content, paddingBottom: '16px' }}>
          {/* Arabic text card with integrated translation toggle */}
          <div style={styles.textCard}>
            {/* Translation toggle button - only show if translation available for this volume */}
            {hasTranslationForVolume && (
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginBottom: '12px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border)',
              }}>
                <button
                  onClick={() => setShowTranslation(!showTranslation)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: showTranslation ? '#3b82f6' : 'var(--border)',
                    color: showTranslation ? 'white' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 8l6 6M4 14l6-6 2 2M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6" />
                  </svg>
                  {showTranslation ? t.hideTranslation : t.showTranslation}
                </button>
              </div>
            )}

            {/* Arabic text */}
            <div style={{ ...styles.arabicText, fontFamily: arabicFontFamily }}>{pageText}</div>

            {/* English translation (if enabled and available) */}
            {hasTranslationForVolume && showTranslation && (
              <div style={{
                marginTop: '20px',
                paddingTop: '20px',
                borderTop: '2px solid #3b82f6',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}>
                  <span style={{
                    background: '#3b82f6',
                    color: 'white',
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}>
                    EN
                  </span>
                  <span style={{
                    fontSize: '0.85rem',
                    color: '#3b82f6',
                    fontWeight: 600,
                  }}>
                    {t.englishTranslation}
                  </span>
                </div>
                {translationText ? (
                  <div style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '1rem',
                    lineHeight: 1.8,
                    textAlign: 'left',
                    direction: 'ltr',
                    color: 'var(--text)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {translationText}
                  </div>
                ) : (
                  <div style={{
                    textAlign: 'center',
                    padding: '20px',
                    color: 'var(--text-secondary)',
                    fontStyle: 'italic',
                  }}>
                    {t.noTranslation}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom page navigation */}
        <PageNavigation variant="bottom" />

        <Nav view={view} onNavigate={setView} t={t} />
      </div>
    );
  }

  // Library View
  if (view === 'library' && selectedBook) {
    const bookTitle = hasBookMetadata(selectedBook.id) ? getBookDisplayName(selectedBook.id, language).title : selectedBook.title;

    const LibraryHeader = () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
        <button style={{ ...styles.backBtn, padding: isDesktop ? '12px' : '10px' }} onClick={() => { setSelectedBook(null); setView('home'); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={isRTL ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: isDesktop ? '1.4rem' : '1.25rem', fontWeight: 600, margin: 0, fontFamily: arabicFontFamily }}>{bookTitle}</h1>
          <p style={{ fontSize: isDesktop ? '0.95rem' : '0.9rem', opacity: 0.9, margin: 0 }}>{volumes.length} {t.volumes}</p>
        </div>
        {/* Delete Book Button */}
        <button
          style={{
            background: 'var(--accent-red-light)',
            border: '1px solid var(--accent-red)',
            borderRadius: '10px',
            padding: isDesktop ? '12px' : '10px',
            color: 'var(--accent-red)',
            cursor: 'pointer',
            display: 'flex',
            transition: 'all 0.15s ease',
          }}
          onClick={() => handleDeleteBook(selectedBook)}
          title={t.deleteBook}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    );

    // Desktop layout
    const libraryBooksCount = books.filter(b => !b.id.endsWith('_en')).length;
    if (isDesktop) {
      return (
        <ResponsiveLayout
          view={view}
          onNavigate={setView}
          t={t}
          isRTL={isRTL}
          isDesktop={isDesktop}
          booksCount={libraryBooksCount}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
          toast={toast}
          showHeader={false}
        >
          <header style={{
            ...styles.header,
            ...responsiveStyles.headerResponsive,
            display: 'flex',
            alignItems: 'center',
          }}>
            <LibraryHeader />
          </header>
          <div style={{ ...styles.content, ...responsiveStyles.contentContainer }}>
            {volumes.length === 0 ? (
              <div style={{ ...styles.empty, padding: '60px 20px' }}>
                <p style={{ fontSize: '1.1rem' }}>{t.noVolumes}</p>
              </div>
            ) : (
              <div style={responsiveStyles.volumeGridResponsive}>
                {volumes.sort((a, b) => a.volume - b.volume).map(v => (
                  <button
                    key={v.volume}
                    style={{ ...styles.volumeBtn, fontSize: '1rem', padding: '16px' }}
                    onClick={() => handleVolumeSelect(v.volume)}
                  >
                    {v.volume}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ResponsiveLayout>
      );
    }

    // Mobile/Tablet layout
    return (
      <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
        <header style={{ ...styles.header, ...(isTablet ? responsiveStyles.headerResponsive : {}) }}>
          <LibraryHeader />
        </header>

        <div style={{ ...styles.content, ...(isTablet ? { padding: '20px 24px' } : {}) }}>
          {volumes.length === 0 ? (
            <div style={styles.empty}>
              <p>{t.noVolumes}</p>
            </div>
          ) : (
            <div style={isTablet ? responsiveStyles.volumeGridResponsive : styles.volumeGrid}>
              {volumes.sort((a, b) => a.volume - b.volume).map(v => (
                <button key={v.volume} style={styles.volumeBtn} onClick={() => handleVolumeSelect(v.volume)}>
                  {v.volume}
                </button>
              ))}
            </div>
          )}
        </div>

        <Nav view={view} onNavigate={setView} t={t} />
        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed',
            bottom: '100px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text)',
            color: 'var(--bg)',
            padding: '12px 20px',
            borderRadius: 'var(--radius)',
            zIndex: 1000,
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.875rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {toast}
          </div>
        )}
      </div>
    );
  }

  // Import View
  if (view === 'import') {
    const importBooksCount = books.filter(b => !b.id.endsWith('_en')).length;

    // Desktop Import View
    if (isDesktop) {
      return (
        <ResponsiveLayout
          view={view}
          onNavigate={setView}
          t={t}
          isRTL={isRTL}
          isDesktop={isDesktop}
          booksCount={importBooksCount}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
          toast={toast}
          headerTitle={t.importDownload}
        >
          <div style={{ ...styles.content, ...responsiveStyles.contentContainer }}>
            {/* Import from ZIP */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {t.importFromZip}
              </div>
              <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileImport} disabled={loading} />
              <div style={{ ...styles.fileLabel, opacity: loading ? 0.6 : 1, padding: '40px 24px' }} onClick={() => !loading && fileInputRef.current?.click()}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                <span style={{ fontWeight: 500, fontSize: '1rem' }}>{loading ? t.importing : t.tapToSelectZip}</span>
              </div>
            </div>

            {/* Available Volumes Download Section */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
                {t.availableVolumes}
              </div>

              <div style={{ maxWidth: '500px' }}>
                <input
                  style={{ ...styles.input, padding: '14px 16px', fontSize: '1rem' }}
                  placeholder={t.serverUrl}
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                />

                <button
                  style={{ ...styles.btn, ...(loadingDownloads ? { opacity: 0.7 } : {}), padding: '14px 20px' }}
                  onClick={fetchAvailableDownloads}
                  disabled={loadingDownloads}
                >
                  {loadingDownloads ? t.loadingVolumes : t.selectVolumes}
                </button>
              </div>

              {(availableBooks.length > 0 || availableDownloads.length > 0 || availableTranslations.length > 0) && (
                <div style={{ marginTop: '24px' }}>
                  {/* Sect Filter for Import */}
                  {availableBooks.length > 1 && (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                        {t.filterBySect}
                      </div>
                      <div style={{
                        display: 'flex',
                        background: 'var(--border)',
                        borderRadius: '10px',
                        padding: '4px',
                        maxWidth: '400px',
                      }}>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importSectFilter === 'all' ? 'var(--card)' : 'transparent',
                            color: importSectFilter === 'all' ? 'var(--primary)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            boxShadow: importSectFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          }}
                          onClick={() => setImportSectFilter('all')}
                        >
                          {t.all}
                        </button>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importSectFilter === 'shia' ? 'var(--primary)' : 'transparent',
                            color: importSectFilter === 'shia' ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                          }}
                          onClick={() => setImportSectFilter('shia')}
                        >
                          {t.shia}
                        </button>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importSectFilter === 'sunni' ? '#3b82f6' : 'transparent',
                            color: importSectFilter === 'sunni' ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                          }}
                          onClick={() => setImportSectFilter('sunni')}
                        >
                          {t.sunni}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Language Filter */}
                  {availableBooks.length > 1 && (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '8px' }}>
                        {t.filterByLanguage}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        background: 'var(--bg)',
                        borderRadius: '10px',
                        padding: '4px',
                        maxWidth: '500px',
                      }}>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importLanguageFilter === 'all' ? 'var(--card)' : 'transparent',
                            color: importLanguageFilter === 'all' ? 'var(--primary)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            boxShadow: importLanguageFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          }}
                          onClick={() => setImportLanguageFilter('all')}
                        >
                          {t.all}
                        </button>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importLanguageFilter === 'ar' ? 'var(--primary)' : 'transparent',
                            color: importLanguageFilter === 'ar' ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                          }}
                          onClick={() => setImportLanguageFilter('ar')}
                        >
                          {t.arabicBooks}
                        </button>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importLanguageFilter === 'fa' ? '#f59e0b' : 'transparent',
                            color: importLanguageFilter === 'fa' ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                          }}
                          onClick={() => setImportLanguageFilter('fa')}
                        >
                          {t.persianBooks}
                        </button>
                        <button
                          style={{
                            flex: 1,
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: 'none',
                            background: importLanguageFilter === 'en' ? '#6366f1' : 'transparent',
                            color: importLanguageFilter === 'en' ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            opacity: 0.6,
                          }}
                          onClick={() => setImportLanguageFilter('en')}
                          title={t.comingSoon}
                        >
                          {t.englishBooks}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Search and Bulk Download Controls */}
                  <div style={{ marginBottom: '20px' }}>
                    {/* Search input */}
                    <input
                      style={{ ...styles.input, maxWidth: '400px', marginBottom: '16px' }}
                      placeholder={t.searchBooksPlaceholder}
                      value={importBookSearch}
                      onChange={e => { setImportBookSearch(e.target.value); setImportBooksPage(1); }}
                    />

                    {/* Bulk Download Buttons */}
                    {!bulkDownloading && !downloadingVolumes && (
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                        <button
                          style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'var(--primary)',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                          onClick={() => downloadAllBySect('shia')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                          {t.downloadAllShia}
                        </button>
                        <button
                          style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#3b82f6',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                          onClick={() => downloadAllBySect('sunni')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                          {t.downloadAllSunni}
                        </button>
                        <button
                          style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#8b5cf6',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                          onClick={() => downloadAllBySect('all')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                          {t.downloadAllBooks}
                        </button>
                      </div>
                    )}

                    {/* Bulk Download Progress */}
                    {bulkDownloading && bulkDownloadProgress && (
                      <div style={{ marginBottom: '16px', maxWidth: '500px' }}>
                        <div style={{
                          height: '8px',
                          background: 'var(--border)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          marginBottom: '8px',
                        }}>
                          <div style={{
                            height: '100%',
                            background: bulkDownloading === 'shia' ? 'var(--primary)' : bulkDownloading === 'sunni' ? '#3b82f6' : '#8b5cf6',
                            width: `${(bulkDownloadProgress.current / bulkDownloadProgress.total) * 100}%`,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {t.downloadingAllBooks} {bulkDownloadProgress.current} / {bulkDownloadProgress.total} ({bulkDownloadProgress.booksCompleted} {t.booksDownloaded})
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Available books list - use grid on desktop with pagination */}
                  {(() => {
                    // Filter books by sect, language and search
                    const filteredBooks = availableBooks.filter(book => {
                      try {
                        const sectMatch = importSectFilter === 'all' || getBookSect(book.bookId || '') === importSectFilter;
                        if (!sectMatch) return false;
                        const languageMatch = importLanguageFilter === 'all' || (book.bookLanguage || 'ar') === importLanguageFilter;
                        if (!languageMatch) return false;
                        if (!importBookSearch.trim()) return true;
                        const searchLower = importBookSearch.toLowerCase();
                        const titleMatch = (book.bookTitle || '').toLowerCase().includes(searchLower) ||
                                           (book.bookTitleAr || '').includes(importBookSearch) ||
                                           (book.bookTitleEn || '').toLowerCase().includes(searchLower);
                        const authorMatch = (book.author || '').toLowerCase().includes(searchLower) ||
                                            (book.authorAr || '').includes(importBookSearch) ||
                                            (book.authorEn || '').toLowerCase().includes(searchLower);
                        return titleMatch || authorMatch;
                      } catch {
                        return false;
                      }
                    });

                    const totalPages = Math.max(1, Math.ceil(filteredBooks.length / IMPORT_BOOKS_PER_PAGE));
                    const startIdx = (importBooksPage - 1) * IMPORT_BOOKS_PER_PAGE;
                    const paginatedBooks = filteredBooks.slice(startIdx, startIdx + IMPORT_BOOKS_PER_PAGE);

                    return (
                      <>
                        {/* Results count */}
                        <div style={{ marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                          {filteredBooks.length > 0
                            ? `${t.showingBooks} ${startIdx + 1}-${Math.min(startIdx + IMPORT_BOOKS_PER_PAGE, filteredBooks.length)} ${t.ofBooks} ${filteredBooks.length} ${t.booksFound}`
                            : t.noResultsFound || 'No books found'
                          }
                        </div>

                        {/* Book grid */}
                        <div style={responsiveStyles.availableBooksGrid}>
                          {paginatedBooks.map((book: AvailableBook) => (
                            <div
                              key={book.slug}
                              style={{
                                ...responsiveStyles.importBookCard,
                                border: selectedImportBook?.slug === book.slug ? '2px solid var(--primary)' : '1px solid var(--border-light)',
                              }}
                              onClick={() => selectImportBook(book)}
                            >
                              <div style={{ fontWeight: 600, fontFamily: language === 'ar' ? arabicFontFamily : 'inherit', fontSize: '1.05rem' }}>
                                {language === 'ar' ? (book.bookTitleAr || book.bookTitle) : (book.bookTitleEn || book.bookTitle)}
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: language === 'ar' ? arabicFontFamily : 'inherit' }}>
                                {book.total} {t.volumes} • {language === 'ar' ? (book.authorAr || book.author || '') : (book.authorEn || book.author || '')}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '20px' }}>
                            <button
                              style={{
                                ...styles.btn,
                                ...styles.btnSecondary,
                                width: 'auto',
                                padding: '10px 20px',
                                opacity: importBooksPage === 1 ? 0.5 : 1,
                              }}
                              onClick={() => setImportBooksPage(p => Math.max(1, p - 1))}
                              disabled={importBooksPage === 1}
                            >
                              {t.previousPage}
                            </button>
                            <span style={{ color: 'var(--text-secondary)' }}>
                              {t.pageOf} {importBooksPage} / {totalPages}
                            </span>
                            <button
                              style={{
                                ...styles.btn,
                                ...styles.btnSecondary,
                                width: 'auto',
                                padding: '10px 20px',
                                opacity: importBooksPage === totalPages ? 0.5 : 1,
                              }}
                              onClick={() => setImportBooksPage(p => Math.min(totalPages, p + 1))}
                              disabled={importBooksPage === totalPages}
                            >
                              {t.nextPage}
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Volume selection when a book is selected */}
                  {selectedImportBook && availableDownloads.length > 0 && (
                    <div style={{ marginTop: '24px', padding: '24px', background: 'var(--border-light)', borderRadius: 'var(--radius)' }}>
                      {/* Import mode toggle */}
                      {availableTranslations.length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                          <div style={{
                            display: 'flex',
                            background: 'var(--border)',
                            borderRadius: '10px',
                            padding: '4px',
                            maxWidth: '300px',
                          }}>
                            <button
                              style={{
                                flex: 1,
                                padding: '10px 14px',
                                borderRadius: '8px',
                                border: 'none',
                                background: importMode === 'arabic' ? 'var(--card)' : 'transparent',
                                color: importMode === 'arabic' ? 'var(--primary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                              }}
                              onClick={() => setImportMode('arabic')}
                            >
                              {t.arabicVolumes}
                            </button>
                            <button
                              style={{
                                flex: 1,
                                padding: '10px 14px',
                                borderRadius: '8px',
                                border: 'none',
                                background: importMode === 'english' ? '#3b82f6' : 'transparent',
                                color: importMode === 'english' ? 'white' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                              }}
                              onClick={() => setImportMode('english')}
                            >
                              {t.englishVolumes}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Volume selection */}
                      <div style={{ marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button style={{ ...styles.btn, ...styles.btnSecondary, width: 'auto', padding: '10px 16px' }} onClick={selectAllVolumes}>
                          {t.selectAll}
                        </button>
                        <button style={{ ...styles.btn, ...styles.btnSecondary, width: 'auto', padding: '10px 16px' }} onClick={deselectAllVolumes}>
                          {t.deselectAll}
                        </button>
                        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                          {selectedVolumes.size} {t.volumesSelected}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
                        {(importMode === 'english' ? availableTranslations : availableDownloads).map(dl => (
                          <button
                            key={dl.volume}
                            style={{
                              ...styles.volumeBtn,
                              width: '50px',
                              height: '50px',
                              aspectRatio: 'auto',
                              background: selectedVolumes.has(dl.volume) ? 'var(--primary)' : 'var(--primary-50)',
                              color: selectedVolumes.has(dl.volume) ? 'white' : 'var(--primary)',
                            }}
                            onClick={() => toggleVolumeSelection(dl.volume)}
                          >
                            {dl.volume}
                          </button>
                        ))}
                      </div>

                      {/* Download button */}
                      <button
                        style={{ ...styles.btn, maxWidth: '300px', ...(downloadingVolumes || selectedVolumes.size === 0 ? { opacity: 0.6 } : {}) }}
                        onClick={downloadSelectedVolumes}
                        disabled={downloadingVolumes || selectedVolumes.size === 0}
                      >
                        {downloadingVolumes ? (
                          <>
                            <div className="spinner spinner-sm" />
                            {downloadProgress ? `${downloadProgress.current}/${downloadProgress.total}` : t.downloading}
                          </>
                        ) : (
                          t.downloadSelected
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </ResponsiveLayout>
      );
    }

    // Mobile/Tablet Import View
    return (
      <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
        <header style={{ ...styles.header, ...styles.headerHome, ...(isTablet ? responsiveStyles.headerResponsive : {}) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'var(--primary-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
            </div>
            <h1 style={{ ...styles.headerTitle, fontFamily: isRTL ? arabicFontFamily : 'inherit', margin: 0 }}>{t.importDownload}</h1>
          </div>
        </header>

        <div style={{ ...styles.content, ...(isTablet ? { padding: '20px 24px' } : {}) }}>
          {/* Import from ZIP */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t.importFromZip}
            </div>
            <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileImport} disabled={loading} />
            <div style={{ ...styles.fileLabel, opacity: loading ? 0.6 : 1 }} onClick={() => !loading && fileInputRef.current?.click()}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" style={{ marginBottom: '8px' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <span style={{ fontWeight: 500 }}>{loading ? t.importing : t.tapToSelectZip}</span>
            </div>
          </div>

          {/* Available Volumes Download Section */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="21 8 21 21 3 21 3 8" />
                <rect x="1" y="3" width="22" height="5" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              {t.availableVolumes}
            </div>

            <input
              style={styles.input}
              placeholder={t.serverUrl}
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
            />

            <button
              style={{ ...styles.btn, ...(loadingDownloads ? { opacity: 0.7 } : {}) }}
              onClick={fetchAvailableDownloads}
              disabled={loadingDownloads}
            >
              {loadingDownloads ? t.loadingVolumes : t.selectVolumes}
            </button>

            {(availableBooks.length > 0 || availableDownloads.length > 0 || availableTranslations.length > 0) && (
              <div style={{ marginTop: '16px' }}>
                {/* Sect Filter for Import */}
                {availableBooks.length > 1 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      {t.filterBySect}
                    </div>
                    <div style={{
                      display: 'flex',
                      background: 'var(--border)',
                      borderRadius: '10px',
                      padding: '4px',
                    }}>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importSectFilter === 'all' ? 'var(--card)' : 'transparent',
                          color: importSectFilter === 'all' ? 'var(--primary)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          boxShadow: importSectFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        }}
                        onClick={() => setImportSectFilter('all')}
                      >
                        {t.all}
                      </button>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importSectFilter === 'shia' ? 'var(--primary)' : 'transparent',
                          color: importSectFilter === 'shia' ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                        }}
                        onClick={() => setImportSectFilter('shia')}
                      >
                        {t.shia}
                      </button>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importSectFilter === 'sunni' ? '#3b82f6' : 'transparent',
                          color: importSectFilter === 'sunni' ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                        }}
                        onClick={() => setImportSectFilter('sunni')}
                      >
                        {t.sunni}
                      </button>
                    </div>

                    {/* Language Filter - Mobile */}
                    <div style={{
                      display: 'flex',
                      gap: '4px',
                      background: 'var(--bg)',
                      borderRadius: '10px',
                      padding: '4px',
                      marginTop: '12px',
                    }}>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 8px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importLanguageFilter === 'all' ? 'var(--card)' : 'transparent',
                          color: importLanguageFilter === 'all' ? 'var(--primary)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          boxShadow: importLanguageFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        }}
                        onClick={() => setImportLanguageFilter('all')}
                      >
                        {t.all}
                      </button>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 8px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importLanguageFilter === 'ar' ? 'var(--primary)' : 'transparent',
                          color: importLanguageFilter === 'ar' ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                        }}
                        onClick={() => setImportLanguageFilter('ar')}
                      >
                        {t.arabicBooks}
                      </button>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 8px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importLanguageFilter === 'fa' ? '#f59e0b' : 'transparent',
                          color: importLanguageFilter === 'fa' ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                        }}
                        onClick={() => setImportLanguageFilter('fa')}
                      >
                        {t.persianBooks}
                      </button>
                      <button
                        style={{
                          flex: 1,
                          padding: '10px 8px',
                          borderRadius: '8px',
                          border: 'none',
                          background: importLanguageFilter === 'en' ? '#6366f1' : 'transparent',
                          color: importLanguageFilter === 'en' ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          opacity: 0.6,
                        }}
                        onClick={() => setImportLanguageFilter('en')}
                        title={t.comingSoon}
                      >
                        {t.englishBooks}
                      </button>
                    </div>

                    {/* Bulk Download Buttons */}
                    {!bulkDownloading && !downloadingVolumes && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            style={{
                              flex: 1,
                              padding: '10px 8px',
                              borderRadius: '10px',
                              border: 'none',
                              background: 'var(--primary)',
                              color: 'white',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                            }}
                            onClick={() => downloadAllBySect('shia')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                            {t.downloadAllShia}
                          </button>
                          <button
                            style={{
                              flex: 1,
                              padding: '10px 8px',
                              borderRadius: '10px',
                              border: 'none',
                              background: '#3b82f6',
                              color: 'white',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                            }}
                            onClick={() => downloadAllBySect('sunni')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                            {t.downloadAllSunni}
                          </button>
                        </div>
                        <button
                          style={{
                            padding: '10px',
                            borderRadius: '10px',
                            border: 'none',
                            background: '#8b5cf6',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                          }}
                          onClick={() => downloadAllBySect('all')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                          {t.downloadAllBooks}
                        </button>
                      </div>
                    )}

                    {/* Bulk Download Progress */}
                    {bulkDownloading && bulkDownloadProgress && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{
                          height: '8px',
                          background: 'var(--border)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          marginBottom: '8px',
                        }}>
                          <div style={{
                            height: '100%',
                            background: bulkDownloading === 'shia' ? 'var(--primary)' : bulkDownloading === 'sunni' ? '#3b82f6' : '#8b5cf6',
                            width: `${(bulkDownloadProgress.current / bulkDownloadProgress.total) * 100}%`,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {t.downloadingAllBooks} {bulkDownloadProgress.current} / {bulkDownloadProgress.total} ({bulkDownloadProgress.booksCompleted} {t.booksDownloaded})
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Search input for books */}
                {availableBooks.length > 1 && (
                  <input
                    style={{ ...styles.input, marginBottom: '12px' }}
                    placeholder={t.searchBooksPlaceholder}
                    value={importBookSearch}
                    onChange={e => { setImportBookSearch(e.target.value); setImportBooksPage(1); }}
                  />
                )}

                {/* Book Selector - show when multiple books available */}
                {availableBooks.length > 1 && (
                  <div style={{ marginBottom: '16px' }}>
                    {(() => {
                      // Filter books by sect, language and search
                      const filteredBooks = availableBooks.filter(book => {
                        try {
                          const sectMatch = importSectFilter === 'all' || getBookSect(book.bookId || '') === importSectFilter;
                          if (!sectMatch) return false;
                          const languageMatch = importLanguageFilter === 'all' || (book.bookLanguage || 'ar') === importLanguageFilter;
                          if (!languageMatch) return false;
                          if (!importBookSearch.trim()) return true;
                          const searchLower = importBookSearch.toLowerCase();
                          const titleMatch = (book.bookTitle || '').toLowerCase().includes(searchLower) ||
                                             (book.bookTitleAr || '').includes(importBookSearch) ||
                                             (book.bookTitleEn || '').toLowerCase().includes(searchLower);
                          const authorMatch = (book.author || '').toLowerCase().includes(searchLower) ||
                                              (book.authorAr || '').includes(importBookSearch) ||
                                              (book.authorEn || '').toLowerCase().includes(searchLower);
                          return titleMatch || authorMatch;
                        } catch {
                          return false;
                        }
                      });

                      const totalPages = Math.max(1, Math.ceil(filteredBooks.length / IMPORT_BOOKS_PER_PAGE));
                      const startIdx = (importBooksPage - 1) * IMPORT_BOOKS_PER_PAGE;
                      const paginatedBooks = filteredBooks.slice(startIdx, startIdx + IMPORT_BOOKS_PER_PAGE);

                      return (
                        <>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            {filteredBooks.length > 0
                              ? `${t.showingBooks} ${startIdx + 1}-${Math.min(startIdx + IMPORT_BOOKS_PER_PAGE, filteredBooks.length)} ${t.ofBooks} ${filteredBooks.length}`
                              : t.noResultsFound || 'No books found'
                            }
                          </div>
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            maxHeight: '250px',
                            overflowY: 'auto',
                          }}>
                            {paginatedBooks.map(book => (
                              <div
                                key={book.slug}
                                onClick={() => selectImportBook(book)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  padding: '12px',
                                  background: selectedImportBook?.slug === book.slug ? 'var(--primary-50)' : 'var(--card)',
                                  border: `2px solid ${selectedImportBook?.slug === book.slug ? 'var(--primary)' : 'var(--border)'}`,
                                  borderRadius: '10px',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                }}
                              >
                                <div style={{
                                  width: '40px',
                                  height: '40px',
                                  borderRadius: '8px',
                                  background: selectedImportBook?.slug === book.slug ? 'var(--primary)' : 'var(--border)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}>
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={selectedImportBook?.slug === book.slug ? 'white' : 'var(--text-secondary)'} strokeWidth="2">
                                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                  </svg>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontFamily: language === 'ar' ? arabicFontFamily : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {language === 'ar' ? (book.bookTitleAr || book.bookTitle) : (book.bookTitleEn || book.bookTitle)}
                                  </div>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: language === 'ar' ? arabicFontFamily : 'inherit' }}>
                                    {book.total} {t.volumes} • {language === 'ar' ? (book.authorAr || book.author || '') : (book.authorEn || book.author || '')}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Pagination */}
                          {totalPages > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                              <button
                                style={{
                                  ...styles.btn,
                                  ...styles.btnSecondary,
                                  width: 'auto',
                                  padding: '8px 14px',
                                  fontSize: '0.85rem',
                                  opacity: importBooksPage === 1 ? 0.5 : 1,
                                }}
                                onClick={() => setImportBooksPage(p => Math.max(1, p - 1))}
                                disabled={importBooksPage === 1}
                              >
                                {t.previousPage}
                              </button>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                {importBooksPage}/{totalPages}
                              </span>
                              <button
                                style={{
                                  ...styles.btn,
                                  ...styles.btnSecondary,
                                  width: 'auto',
                                  padding: '8px 14px',
                                  fontSize: '0.85rem',
                                  opacity: importBooksPage === totalPages ? 0.5 : 1,
                                }}
                                onClick={() => setImportBooksPage(p => Math.min(totalPages, p + 1))}
                                disabled={importBooksPage === totalPages}
                              >
                                {t.nextPage}
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Book Name Header */}
                {selectedImportBook && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    background: importMode === 'english' ? 'rgba(59, 130, 246, 0.1)' : 'var(--primary-50)',
                    borderRadius: '12px',
                    marginBottom: '16px',
                  }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '10px',
                      background: importMode === 'english' ? '#3b82f6' : 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        fontFamily: language === 'ar' ? arabicFontFamily : 'inherit',
                        color: 'var(--text)',
                      }}>
                        {language === 'ar'
                          ? (selectedImportBook.bookTitleAr || selectedImportBook.bookTitle)
                          : (selectedImportBook.bookTitleEn || selectedImportBook.bookTitle)}
                      </div>
                      <div style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        fontFamily: language === 'ar' ? arabicFontFamily : 'inherit',
                      }}>
                        {language === 'ar'
                          ? (selectedImportBook.authorAr || selectedImportBook.author || '')
                          : (selectedImportBook.authorEn || selectedImportBook.author || '')}
                      </div>
                    </div>
                  </div>
                )}

                {/* Arabic/English Toggle */}
                <div style={{
                  display: 'flex',
                  background: 'var(--border)',
                  borderRadius: '10px',
                  padding: '4px',
                  marginBottom: '16px',
                }}>
                  <button
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: importMode === 'arabic' ? 'var(--primary)' : 'transparent',
                      color: importMode === 'arabic' ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      transition: 'all 0.2s ease',
                    }}
                    onClick={() => { setImportMode('arabic'); setSelectedVolumes(new Set()); }}
                  >
                    {t.arabicVolumes} ({availableDownloads.length})
                  </button>
                  <button
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: importMode === 'english' ? '#3b82f6' : 'transparent',
                      color: importMode === 'english' ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      transition: 'all 0.2s ease',
                    }}
                    onClick={() => { setImportMode('english'); setSelectedVolumes(new Set()); }}
                  >
                    {t.englishVolumes} ({availableTranslations.length})
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {selectedVolumes.size} {t.volumesSelected}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      style={{ ...styles.btn, padding: '8px 12px', fontSize: '0.85rem', width: 'auto' }}
                      onClick={selectAllVolumes}
                    >
                      {t.selectAll}
                    </button>
                    <button
                      style={{ ...styles.btn, ...styles.btnSecondary, padding: '8px 12px', fontSize: '0.85rem', width: 'auto' }}
                      onClick={deselectAllVolumes}
                    >
                      {t.deselectAll}
                    </button>
                  </div>
                </div>

                {/* Volume list based on import mode */}
                {importMode === 'english' && availableTranslations.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'var(--text-secondary)',
                    border: '1px dashed var(--border)',
                    borderRadius: '12px',
                    marginBottom: '12px',
                  }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '12px', opacity: 0.5 }}>
                      <path d="M5 8l6 6M4 14l6-6 2 2M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6" />
                    </svg>
                    <p>{t.noTranslationsAvailable}</p>
                  </div>
                ) : (
                  <div style={{
                    maxHeight: '300px',
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    marginBottom: '12px'
                  }}>
                    {(importMode === 'english' ? availableTranslations : availableDownloads).map(dl => {
                      const isSelected = selectedVolumes.has(dl.volume);
                      const isImported = volumesStore.some(v => v.bookId === dl.bookId && v.volume === dl.volume);
                      const accentColor = importMode === 'english' ? '#3b82f6' : 'var(--primary)';
                      return (
                        <div
                          key={`${importMode}-${dl.volume}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '12px 16px',
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                            background: isSelected ? (importMode === 'english' ? 'rgba(59, 130, 246, 0.1)' : 'var(--primary-50)') : 'transparent',
                          }}
                          onClick={() => toggleVolumeSelection(dl.volume)}
                        >
                          <div style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '6px',
                            border: `2px solid ${isSelected ? accentColor : 'var(--border)'}`,
                            background: isSelected ? accentColor : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: isRTL ? '0' : '12px',
                            marginLeft: isRTL ? '12px' : '0',
                          }}>
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontFamily: importMode === 'arabic' ? arabicFontFamily : 'inherit', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {importMode === 'english' && (
                                <span style={{
                                  background: '#3b82f6',
                                  color: 'white',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                }}>EN</span>
                              )}
                              {t.volume} {dl.volume}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                              {dl.sizeFormatted}
                              {isImported && (
                                <span style={{ color: accentColor, marginLeft: '8px', marginRight: '8px' }}>
                                  ✓
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {downloadingVolumes ? (
                  <div>
                    <div style={styles.progressBar}>
                      <div style={{ ...styles.progressFill, width: `${(downloadProgress?.current || 0) / (downloadProgress?.total || 1) * 100}%`, background: importMode === 'english' ? '#3b82f6' : undefined }} />
                    </div>
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {t.downloading} {downloadProgress?.current} / {downloadProgress?.total}
                    </div>
                  </div>
                ) : (
                  <button
                    style={{ ...styles.btn, opacity: selectedVolumes.size > 0 ? 1 : 0.5, background: importMode === 'english' ? '#3b82f6' : undefined }}
                    onClick={downloadSelectedVolumes}
                    disabled={selectedVolumes.size === 0}
                  >
                    {t.downloadSelected} ({selectedVolumes.size})
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        <Nav view={view} onNavigate={setView} t={t} />
      </div>
    );
  }

  // Search View
  if (view === 'search') {
    // Preview converted text for Roman input
    const previewArabic = inputMode === 'roman' && searchQuery.trim() ? romanToArabic(searchQuery.trim()) : '';
    const searchBooksCount = books.filter(b => !b.id.endsWith('_en')).length;

    // For desktop, wrap in ResponsiveLayout
    if (isDesktop) {
      return (
        <ResponsiveLayout
          view={view}
          onNavigate={setView}
          t={t}
          isRTL={isRTL}
          isDesktop={isDesktop}
          booksCount={searchBooksCount}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
          toast={toast}
          headerTitle={t.search}
        >
          <div style={{ ...styles.content, ...responsiveStyles.contentContainer }}>
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '800px' }}>
              {/* Search Options Row */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {/* Input Mode */}
                <div style={{ flex: '1 1 200px' }}>
                  <div style={styles.searchOptionLabel as React.CSSProperties}>{t.inputMode}</div>
                  <div style={styles.segmentedControl as React.CSSProperties}>
                    <button
                      style={{ ...styles.segmentBtn as React.CSSProperties, ...(inputMode === 'arabic' ? styles.segmentBtnActive as React.CSSProperties : {}) }}
                      onClick={() => setInputMode('arabic')}
                      type="button"
                    >
                      {t.arabicInput}
                    </button>
                    <button
                      style={{ ...styles.segmentBtn as React.CSSProperties, ...(inputMode === 'roman' ? styles.segmentBtnActive as React.CSSProperties : {}) }}
                      onClick={() => setInputMode('roman')}
                      type="button"
                    >
                      {t.romanInput}
                    </button>
                  </div>
                </div>

                {/* Match Mode */}
                <div style={{ flex: '1 1 200px' }}>
                  <div style={styles.searchOptionLabel as React.CSSProperties}>{t.searchMode}</div>
                  <div style={styles.segmentedControl as React.CSSProperties}>
                    <button
                      style={{ ...styles.segmentBtn as React.CSSProperties, ...(searchMode === 'exact' ? styles.segmentBtnActive as React.CSSProperties : {}) }}
                      onClick={() => setSearchMode('exact')}
                      type="button"
                    >
                      {t.exactMatch}
                    </button>
                    <button
                      style={{ ...styles.segmentBtn as React.CSSProperties, ...(searchMode === 'root' ? styles.segmentBtnActive as React.CSSProperties : {}) }}
                      onClick={() => setSearchMode('root')}
                      type="button"
                    >
                      {t.rootMatch}
                    </button>
                  </div>
                </div>
              </div>

              {/* Sect Filter */}
              <div style={{ marginBottom: '20px' }}>
                <div style={styles.searchOptionLabel as React.CSSProperties}>{t.filterBySect}</div>
                <div style={{ display: 'flex', background: 'var(--border)', borderRadius: '10px', padding: '4px', maxWidth: '400px' }}>
                  <button type="button" style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: 'none', background: searchSectFilter === 'all' ? 'var(--card)' : 'transparent', color: searchSectFilter === 'all' ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, boxShadow: searchSectFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }} onClick={() => setSearchSectFilter('all')}>{t.all}</button>
                  <button type="button" style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: 'none', background: searchSectFilter === 'shia' ? 'var(--primary)' : 'transparent', color: searchSectFilter === 'shia' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }} onClick={() => setSearchSectFilter('shia')}>{t.shia}</button>
                  <button type="button" style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: 'none', background: searchSectFilter === 'sunni' ? '#3b82f6' : 'transparent', color: searchSectFilter === 'sunni' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }} onClick={() => setSearchSectFilter('sunni')}>{t.sunni}</button>
                </div>
              </div>

              {/* Preview Arabic (if Roman input) */}
              {previewArabic && (
                <div style={styles.convertedText as React.CSSProperties}>
                  <span style={{ fontWeight: 600 }}>{t.convertedTo}:</span>
                  <span style={{ fontFamily: arabicFontFamily, fontSize: '1.1rem' }}>{previewArabic}</span>
                </div>
              )}

              {/* Search Input */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                <input
                  style={{ ...styles.input, flex: 1, marginBottom: 0, padding: '14px 16px', fontSize: '1rem', fontFamily: inputMode === 'arabic' ? arabicFontFamily : 'inherit' }}
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && performSearch(searchQuery)}
                  dir={inputMode === 'arabic' ? 'rtl' : 'ltr'}
                />
                <button
                  style={{ ...styles.btn, width: 'auto', padding: '14px 28px' }}
                  onClick={() => performSearch(searchQuery)}
                  disabled={isSearching || !searchQuery.trim()}
                >
                  {isSearching ? <div className="spinner spinner-sm" /> : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </ResponsiveLayout>
      );
    }

    // Mobile/Tablet Search View
    return (
      <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
        <header style={{ ...styles.header, ...styles.headerHome, ...(isTablet ? responsiveStyles.headerResponsive : {}) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'var(--primary-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <h1 style={{ ...styles.headerTitle, fontFamily: isRTL ? arabicFontFamily : 'inherit', margin: 0 }}>{t.search}</h1>
          </div>
        </header>

        <div style={{ ...styles.content, ...(isTablet ? { padding: '20px 24px' } : {}) }}>
          <div style={styles.card}>
            {/* Search Options Row */}
            <div style={styles.searchOptionsRow as React.CSSProperties}>
              {/* Input Mode */}
              <div style={styles.searchOptionGroup as React.CSSProperties}>
                <div style={styles.searchOptionLabel as React.CSSProperties}>{t.inputMode}</div>
                <div style={styles.segmentedControl as React.CSSProperties}>
                  <button
                    style={{
                      ...styles.segmentBtn as React.CSSProperties,
                      ...(inputMode === 'arabic' ? styles.segmentBtnActive as React.CSSProperties : {})
                    }}
                    onClick={() => setInputMode('arabic')}
                    type="button"
                  >
                    {t.arabicInput}
                  </button>
                  <button
                    style={{
                      ...styles.segmentBtn as React.CSSProperties,
                      ...(inputMode === 'roman' ? styles.segmentBtnActive as React.CSSProperties : {})
                    }}
                    onClick={() => setInputMode('roman')}
                    type="button"
                  >
                    {t.romanInput}
                  </button>
                </div>
              </div>

              {/* Match Mode */}
              <div style={styles.searchOptionGroup as React.CSSProperties}>
                <div style={styles.searchOptionLabel as React.CSSProperties}>{t.searchMode}</div>
                <div style={styles.segmentedControl as React.CSSProperties}>
                  <button
                    style={{
                      ...styles.segmentBtn as React.CSSProperties,
                      ...(searchMode === 'exact' ? styles.segmentBtnActive as React.CSSProperties : {})
                    }}
                    onClick={() => setSearchMode('exact')}
                    type="button"
                  >
                    {t.exactMatch}
                  </button>
                  <button
                    style={{
                      ...styles.segmentBtn as React.CSSProperties,
                      ...(searchMode === 'root' ? styles.segmentBtnActive as React.CSSProperties : {})
                    }}
                    onClick={() => setSearchMode('root')}
                    type="button"
                  >
                    {t.rootMatch}
                  </button>
                </div>
              </div>
            </div>

            {/* Sect Filter for Search */}
            <div style={{ marginBottom: '16px' }}>
              <div style={styles.searchOptionLabel as React.CSSProperties}>{t.filterBySect}</div>
              <div style={{
                display: 'flex',
                background: 'var(--border)',
                borderRadius: '10px',
                padding: '4px',
              }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: searchSectFilter === 'all' ? 'var(--card)' : 'transparent',
                    color: searchSectFilter === 'all' ? 'var(--primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    boxShadow: searchSectFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                  onClick={() => setSearchSectFilter('all')}
                >
                  {t.all}
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: searchSectFilter === 'shia' ? 'var(--primary)' : 'transparent',
                    color: searchSectFilter === 'shia' ? 'white' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                  onClick={() => setSearchSectFilter('shia')}
                >
                  {t.shia}
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: searchSectFilter === 'sunni' ? '#3b82f6' : 'transparent',
                    color: searchSectFilter === 'sunni' ? 'white' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                  onClick={() => setSearchSectFilter('sunni')}
                >
                  {t.sunni}
                </button>
              </div>
            </div>

            {/* Book Selector for Search */}
            {books.filter(b => !b.id.endsWith('_en')).length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={styles.searchOptionLabel as React.CSSProperties}>{t.selectBooks}</div>
                <button
                  type="button"
                  onClick={() => setShowBookSelector(!showBookSelector)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.9rem',
                    color: 'var(--text)',
                  }}
                >
                  <span>
                    {searchSelectedBooks.size === 0
                      ? t.allBooksSelected
                      : `${searchSelectedBooks.size} ${t.booksSelected}`}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ transform: showBookSelector ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {showBookSelector && (
                  <div style={{
                    marginTop: '8px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    background: 'var(--card)',
                  }}>
                    {/* Clear selection button */}
                    {searchSelectedBooks.size > 0 && (
                      <div
                        style={{
                          padding: '10px 16px',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          color: 'var(--primary)',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                        onClick={() => setSearchSelectedBooks(new Set())}
                      >
                        {t.all} ({t.allBooksSelected})
                      </div>
                    )}
                    {books.filter(b => !b.id.endsWith('_en')).filter(book => {
                      if (searchSectFilter === 'all') return true;
                      return getBookSect(book.id) === searchSectFilter;
                    }).map(book => (
                      <div
                        key={book.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '10px 16px',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: searchSelectedBooks.has(book.id) ? 'var(--primary-50)' : 'transparent',
                        }}
                        onClick={() => {
                          setSearchSelectedBooks(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(book.id)) {
                              newSet.delete(book.id);
                            } else {
                              newSet.add(book.id);
                            }
                            return newSet;
                          });
                        }}
                      >
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '4px',
                          border: `2px solid ${searchSelectedBooks.has(book.id) ? 'var(--primary)' : 'var(--border)'}`,
                          background: searchSelectedBooks.has(book.id) ? 'var(--primary)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: isRTL ? '0' : '10px',
                          marginLeft: isRTL ? '10px' : '0',
                          flexShrink: 0,
                        }}>
                          {searchSelectedBooks.has(book.id) && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: arabicFontFamily,
                            fontSize: '0.9rem',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {book.title}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: getBookSect(book.id) === 'shia' ? 'var(--primary-50)' : 'rgba(59, 130, 246, 0.1)',
                          color: getBookSect(book.id) === 'shia' ? 'var(--primary)' : '#3b82f6',
                          marginLeft: isRTL ? '0' : '8px',
                          marginRight: isRTL ? '8px' : '0',
                          flexShrink: 0,
                        }}>
                          {getBookSect(book.id) === 'shia' ? t.shia : t.sunni}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); performSearch(searchQuery); }}>
              <input
                style={{
                  ...styles.input,
                  direction: inputMode === 'roman' ? 'ltr' : 'rtl',
                  textAlign: inputMode === 'roman' ? 'left' : 'right',
                }}
                placeholder={inputMode === 'roman' ? 'e.g., muhammad, allah, hadith, imam...' : t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />

              {/* Show converted Arabic text when using Roman input */}
              {previewArabic && (
                <div style={styles.convertedText as React.CSSProperties}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <span style={{ fontFamily: arabicFontFamily, fontSize: '1.1rem', direction: 'rtl' }}>
                    {previewArabic}
                  </span>
                </div>
              )}

              <button
                type="submit"
                style={{ ...styles.btn, opacity: searchQuery.trim() ? 1 : 0.5 }}
                disabled={!searchQuery.trim() || isSearching}
              >
                {isSearching ? (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" opacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    {t.searching}
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    {t.search}
                  </>
                )}
              </button>
            </form>
          </div>

          {pagesStore.length === 0 && (
            <div style={styles.empty}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: '16px' }}>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <p>{t.noBooks}</p>
              <button
                style={{ ...styles.btn, marginTop: '16px', width: 'auto', padding: '12px 24px' }}
                onClick={() => setView('import')}
              >
                {t.importBook}
              </button>
            </div>
          )}
        </div>

        <Nav view={view} onNavigate={setView} t={t} />
      </div>
    );
  }

  // Search Results View
  if (view === 'searchResults') {
    // Pagination calculations
    const totalResultsPages = Math.ceil(searchResults.length / RESULTS_PER_PAGE);
    const startIndex = (searchResultsPage - 1) * RESULTS_PER_PAGE;
    const endIndex = Math.min(startIndex + RESULTS_PER_PAGE, searchResults.length);
    const paginatedResults = searchResults.slice(startIndex, endIndex);
    const searchResultsBooksCount = books.filter(b => !b.id.endsWith('_en')).length;

    // Pagination controls component
    const ResultsPagination = ({ variant = 'top' }: { variant?: 'top' | 'bottom' }) => {
      if (totalResultsPages <= 1) return null;

      return (
        <div style={{
          display: 'flex',
          justifyContent: variant === 'top' ? 'space-between' : 'center',
          alignItems: 'center',
          marginBottom: variant === 'top' ? '16px' : '8px',
          marginTop: variant === 'bottom' ? '16px' : '0',
          padding: '12px 16px',
          background: 'var(--card)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-sm)',
          gap: '8px',
        }}>
          <button
            onClick={() => setSearchResultsPage(p => Math.max(1, p - 1))}
            disabled={searchResultsPage === 1}
            style={{
              padding: variant === 'top' ? '8px 16px' : '10px 20px',
              borderRadius: '8px',
              border: 'none',
              background: searchResultsPage === 1 ? 'var(--border)' : 'var(--primary)',
              color: searchResultsPage === 1 ? 'var(--text-secondary)' : 'white',
              cursor: searchResultsPage === 1 ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              opacity: searchResultsPage === 1 ? 0.5 : 1,
            }}
          >
            {variant === 'top' ? `${isRTL ? '→' : '←'} ${t.previousPage}` : (isRTL ? '→' : '←')}
          </button>
          <span style={{ fontSize: '0.9rem', color: variant === 'top' ? 'var(--text-secondary)' : 'var(--text)', padding: variant === 'bottom' ? '0 16px' : '0' }}>
            {variant === 'top' ? `${t.pageOf} ${searchResultsPage} / ${totalResultsPages}` : `${searchResultsPage} / ${totalResultsPages}`}
          </span>
          <button
            onClick={() => setSearchResultsPage(p => Math.min(totalResultsPages, p + 1))}
            disabled={searchResultsPage === totalResultsPages}
            style={{
              padding: variant === 'top' ? '8px 16px' : '10px 20px',
              borderRadius: '8px',
              border: 'none',
              background: searchResultsPage === totalResultsPages ? 'var(--border)' : 'var(--primary)',
              color: searchResultsPage === totalResultsPages ? 'var(--text-secondary)' : 'white',
              cursor: searchResultsPage === totalResultsPages ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              opacity: searchResultsPage === totalResultsPages ? 0.5 : 1,
            }}
          >
            {variant === 'top' ? `${t.nextPage} ${isRTL ? '←' : '→'}` : (isRTL ? '←' : '→')}
          </button>
        </div>
      );
    };

    // Desktop Search Results View
    if (isDesktop) {
      return (
        <ResponsiveLayout
          view={view}
          onNavigate={setView}
          t={t}
          isRTL={isRTL}
          isDesktop={isDesktop}
          booksCount={searchResultsBooksCount}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
          toast={toast}
          headerTitle={t.searchResults}
          headerContent={
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                style={{
                  background: 'var(--border-light)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text)',
                  fontSize: '0.9rem',
                }}
                onClick={() => setView('search')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d={isRTL ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
                </svg>
                {t.backToSearch}
              </button>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                "{savedSearchQuery}" - {searchResults.length} {t.resultsFound}
              </span>
            </div>
          }
        >
          <div style={{ ...styles.content, ...responsiveStyles.contentContainer }}>
            {searchResults.length === 0 ? (
              <div style={{ ...styles.empty, padding: '80px 20px' }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: '16px' }}>
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <p>{t.noResults}</p>
              </div>
            ) : (
              <>
                <ResultsPagination variant="top" />

                {/* Search results showing range */}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', textAlign: 'center' }}>
                  {startIndex + 1} - {endIndex} {t.of} {searchResults.length}
                </div>

                {/* Results grid for desktop */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '16px' }}>
                  {paginatedResults.map((result, index) => (
                    <div
                      key={`${result.bookId}-${result.volume}-${result.page}-${result.matchIndex}-${startIndex + index}`}
                      style={{
                        ...styles.card,
                        ...responsiveStyles.cardResponsive,
                        cursor: 'pointer',
                        padding: '20px',
                      }}
                      onClick={() => goToSearchResult(result)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--primary)' }}>
                          {result.bookTitle}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--primary-50)', padding: '4px 10px', borderRadius: '6px' }}>
                          {t.volume} {result.volume} • {t.page} {result.page}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: arabicFontFamily,
                          fontSize: '1.05rem',
                          lineHeight: 1.9,
                          color: 'var(--text)',
                          textAlign: 'right',
                          direction: 'rtl',
                        }}
                        dangerouslySetInnerHTML={{
                          __html: result.snippet.split(savedSearchQuery).join(
                            `<mark style="background: #fef08a; padding: 0 2px; border-radius: 2px;">${savedSearchQuery}</mark>`
                          )
                        }}
                      />
                    </div>
                  ))}
                </div>

                <ResultsPagination variant="bottom" />
              </>
            )}
          </div>
        </ResponsiveLayout>
      );
    }

    // Mobile/Tablet Search Results View
    return (
      <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <button style={styles.backBtn} onClick={() => setView('search')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={isRTL ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
              </svg>
            </button>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>{t.searchResults}</h1>
              <p style={{ fontSize: '0.85rem', opacity: 0.9, margin: 0 }}>
                "{savedSearchQuery}" - {searchResults.length} {t.resultsFound}
              </p>
            </div>
          </div>
        </header>

        <div style={styles.content}>
          {searchResults.length === 0 ? (
            <div style={styles.empty}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: '16px' }}>
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <p>{t.noResults}</p>
            </div>
          ) : (
            <>
              {/* Pagination info */}
              {totalResultsPages > 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                  padding: '12px 16px',
                  background: 'var(--card)',
                  borderRadius: '12px',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <button
                    onClick={() => setSearchResultsPage(p => Math.max(1, p - 1))}
                    disabled={searchResultsPage === 1}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: searchResultsPage === 1 ? 'var(--border)' : 'var(--primary)',
                      color: searchResultsPage === 1 ? 'var(--text-secondary)' : 'white',
                      cursor: searchResultsPage === 1 ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      opacity: searchResultsPage === 1 ? 0.5 : 1,
                    }}
                  >
                    {isRTL ? '→' : '←'} {t.previousPage}
                  </button>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {t.pageOf} {searchResultsPage} / {totalResultsPages}
                  </span>
                  <button
                    onClick={() => setSearchResultsPage(p => Math.min(totalResultsPages, p + 1))}
                    disabled={searchResultsPage === totalResultsPages}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: searchResultsPage === totalResultsPages ? 'var(--border)' : 'var(--primary)',
                      color: searchResultsPage === totalResultsPages ? 'var(--text-secondary)' : 'white',
                      cursor: searchResultsPage === totalResultsPages ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      opacity: searchResultsPage === totalResultsPages ? 0.5 : 1,
                    }}
                  >
                    {t.nextPage} {isRTL ? '←' : '→'}
                  </button>
                </div>
              )}

              {/* Search results showing range */}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', textAlign: 'center' }}>
                {startIndex + 1} - {endIndex} {t.of} {searchResults.length}
              </div>

              {/* Paginated results */}
              {paginatedResults.map((result, index) => (
                <div
                  key={`${result.bookId}-${result.volume}-${result.page}-${result.matchIndex}-${startIndex + index}`}
                  style={{
                    ...styles.card,
                    cursor: 'pointer',
                    padding: '16px',
                    marginBottom: '12px',
                  }}
                  onClick={() => goToSearchResult(result)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--primary)' }}>
                      {result.bookTitle}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--primary-50)', padding: '4px 8px', borderRadius: '6px' }}>
                      {t.volume} {result.volume} • {t.page} {result.page}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: arabicFontFamily,
                      fontSize: '1rem',
                      lineHeight: 1.8,
                      color: 'var(--text)',
                      textAlign: 'right',
                      direction: 'rtl',
                    }}
                    dangerouslySetInnerHTML={{
                      __html: result.snippet.split(savedSearchQuery).join(
                        `<mark style="background: #fef08a; padding: 0 2px; border-radius: 2px;">${savedSearchQuery}</mark>`
                      )
                    }}
                  />
                </div>
              ))}

              {/* Bottom pagination */}
              {totalResultsPages > 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '16px',
                  marginBottom: '8px',
                }}>
                  <button
                    onClick={() => setSearchResultsPage(p => Math.max(1, p - 1))}
                    disabled={searchResultsPage === 1}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: searchResultsPage === 1 ? 'var(--border)' : 'var(--primary)',
                      color: searchResultsPage === 1 ? 'var(--text-secondary)' : 'white',
                      cursor: searchResultsPage === 1 ? 'not-allowed' : 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      opacity: searchResultsPage === 1 ? 0.5 : 1,
                    }}
                  >
                    {isRTL ? '→' : '←'}
                  </button>
                  <span style={{ padding: '0 16px', fontSize: '0.9rem', color: 'var(--text)' }}>
                    {searchResultsPage} / {totalResultsPages}
                  </span>
                  <button
                    onClick={() => setSearchResultsPage(p => Math.min(totalResultsPages, p + 1))}
                    disabled={searchResultsPage === totalResultsPages}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: searchResultsPage === totalResultsPages ? 'var(--border)' : 'var(--primary)',
                      color: searchResultsPage === totalResultsPages ? 'var(--text-secondary)' : 'white',
                      cursor: searchResultsPage === totalResultsPages ? 'not-allowed' : 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      opacity: searchResultsPage === totalResultsPages ? 0.5 : 1,
                    }}
                  >
                    {isRTL ? '←' : '→'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <Nav view={view} onNavigate={setView} t={t} />
      </div>
    );
  }

  // Settings View
  if (view === 'settings') {
    const settingsBooksCount = books.filter(b => !b.id.endsWith('_en')).length;

    // Desktop Settings View
    if (isDesktop) {
      return (
        <ResponsiveLayout
          view={view}
          onNavigate={setView}
          t={t}
          isRTL={isRTL}
          isDesktop={isDesktop}
          booksCount={settingsBooksCount}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
          toast={toast}
          headerTitle={t.settings}
        >
          <div style={{ ...styles.content, ...responsiveStyles.contentContainer }}>
            {/* Theme Toggle */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {theme === 'dark' ? (
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </>
                  )}
                </svg>
                {t.theme}
              </div>
              <div style={{ ...styles.segmentedControl, maxWidth: '300px' }}>
                <button
                  style={{ ...styles.segmentBtn, ...(theme === 'light' ? styles.segmentBtnActive : {}) }}
                  onClick={() => changeTheme('light')}
                >
                  {t.lightMode}
                </button>
                <button
                  style={{ ...styles.segmentBtn, ...(theme === 'dark' ? styles.segmentBtnActive : {}) }}
                  onClick={() => changeTheme('dark')}
                >
                  {t.darkMode}
                </button>
              </div>
            </div>

            {/* Language Toggle */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                {t.language}
              </div>
              <div style={{ ...styles.segmentedControl, maxWidth: '300px' }}>
                <button
                  style={{ ...styles.segmentBtn, ...(language === 'en' ? styles.segmentBtnActive : {}) }}
                  onClick={() => changeLanguage('en')}
                >
                  {t.english}
                </button>
                <button
                  style={{ ...styles.segmentBtn, ...(language === 'ar' ? styles.segmentBtnActive : {}) }}
                  onClick={() => changeLanguage('ar')}
                >
                  {t.arabic}
                </button>
              </div>
            </div>

            {/* Arabic Font Selection */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7V4h16v3M9 20h6M12 4v16" />
                </svg>
                {t.arabicFont}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {(Object.entries(ARABIC_FONTS) as [ArabicFont, typeof ARABIC_FONTS['amiri']][]).map(([key, font]) => (
                  <button
                    key={key}
                    style={{
                      padding: '16px 14px',
                      borderRadius: '10px',
                      border: `2px solid ${arabicFont === key ? 'var(--primary)' : 'var(--border)'}`,
                      background: arabicFont === key ? 'var(--primary-50)' : 'var(--card)',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                    onClick={() => changeArabicFont(key)}
                  >
                    <div style={{ fontFamily: font.family, fontSize: '1.2rem', marginBottom: '6px', color: 'var(--text)' }}>
                      بسم الله
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {language === 'ar' ? font.displayNameAr : font.displayName}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Reading Mode Selection */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                {t.readingMode}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    border: `2px solid ${readingMode === 'pagination' ? 'var(--primary)' : 'var(--border)'}`,
                    background: readingMode === 'pagination' ? 'var(--primary-50)' : 'var(--card)',
                    cursor: 'pointer',
                    textAlign: isRTL ? 'right' : 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                  }}
                  onClick={() => changeReadingMode('pagination')}
                >
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: readingMode === 'pagination' ? 'var(--primary)' : 'var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={readingMode === 'pagination' ? 'white' : 'var(--text-secondary)'} strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.95rem' }}>{t.paginationMode}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t.paginationDesc}</div>
                  </div>
                </button>
                <button
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    border: `2px solid ${readingMode === 'scroll' ? 'var(--primary)' : 'var(--border)'}`,
                    background: readingMode === 'scroll' ? 'var(--primary-50)' : 'var(--card)',
                    cursor: 'pointer',
                    textAlign: isRTL ? 'right' : 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                  }}
                  onClick={() => changeReadingMode('scroll')}
                >
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: readingMode === 'scroll' ? 'var(--primary)' : 'var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={readingMode === 'scroll' ? 'white' : 'var(--text-secondary)'} strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.95rem' }}>{t.scrollMode}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t.scrollDesc}</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Statistics */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M18 17V9" />
                  <path d="M13 17V5" />
                  <path d="M8 17v-3" />
                </svg>
                {t.statistics}
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{
                  flex: 1,
                  background: 'var(--primary-50)',
                  padding: '20px',
                  borderRadius: '12px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '4px' }}>
                    {settingsBooksCount}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.books}</div>
                </div>
                <div style={{
                  flex: 1,
                  background: 'var(--accent-blue-light)',
                  padding: '20px',
                  borderRadius: '12px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '4px' }}>
                    {pagesStore.length}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.pages}</div>
                </div>
              </div>
            </div>

            {/* Delete Data */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {t.deleteAllData}
              </div>
              <button
                style={{
                  ...styles.btn,
                  background: 'var(--accent-red)',
                  maxWidth: '300px',
                }}
                onClick={async () => {
                  if (!confirm(t.deleteAllData + '?')) return;
                  booksStore = [];
                  volumesStore = [];
                  pagesStore = [];
                  await clearAllFromDB();
                  setBooks([]);
                  setSelectedBook(null);
                  setVolumes([]);
                  setDataVersion(v => v + 1);
                  setView('home');
                  showToast(t.dataDeleted);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                </svg>
                {t.deleteAllData}
              </button>
            </div>

            {/* Help & Guide */}
            <div style={{ ...styles.card, ...responsiveStyles.cardResponsive, maxWidth: '600px' }}>
              <div style={styles.cardTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t.help}
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
                {t.userGuideDesc}
              </p>
              <a
                href="guide.html"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...styles.btn,
                  ...styles.btnSecondary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  textDecoration: 'none',
                  maxWidth: '200px',
                  justifyContent: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                {t.openGuide}
              </a>
            </div>
          </div>
        </ResponsiveLayout>
      );
    }

    // Mobile/Tablet Settings View
    return (
      <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
        <header style={{ ...styles.header, ...styles.headerHome, ...(isTablet ? responsiveStyles.headerResponsive : {}) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'var(--primary-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </div>
            <h1 style={{ ...styles.headerTitle, fontFamily: isRTL ? arabicFontFamily : 'inherit', margin: 0 }}>{t.settings}</h1>
          </div>
        </header>

        <div style={{ ...styles.content, ...(isTablet ? { padding: '20px 24px' } : {}) }}>
          {/* Theme Toggle */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {theme === 'dark' ? (
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                ) : (
                  <>
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </>
                )}
              </svg>
              {t.theme}
            </div>
            <div style={{
              display: 'flex',
              background: 'var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px',
              gap: '4px',
            }}>
              <button
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: theme === 'light' ? 'var(--card)' : 'transparent',
                  color: theme === 'light' ? 'var(--primary)' : 'var(--text-tertiary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: theme === 'light' ? 'var(--shadow-xs)' : 'none',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => changeTheme('light')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                {t.lightMode}
              </button>
              <button
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: theme === 'dark' ? 'var(--card)' : 'transparent',
                  color: theme === 'dark' ? 'var(--primary)' : 'var(--text-tertiary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: theme === 'dark' ? 'var(--shadow-xs)' : 'none',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => changeTheme('dark')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                {t.darkMode}
              </button>
            </div>
          </div>

          {/* Language Toggle */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              {t.language}
            </div>
            <div style={{
              display: 'flex',
              background: 'var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px',
              gap: '4px',
            }}>
              <button
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: language === 'en' ? 'var(--card)' : 'transparent',
                  color: language === 'en' ? 'var(--primary)' : 'var(--text-tertiary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: language === 'en' ? 'var(--shadow-xs)' : 'none',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => changeLanguage('en')}
              >
                {t.english}
              </button>
              <button
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: language === 'ar' ? 'var(--card)' : 'transparent',
                  color: language === 'ar' ? 'var(--primary)' : 'var(--text-tertiary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: language === 'ar' ? 'var(--shadow-xs)' : 'none',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => changeLanguage('ar')}
              >
                {t.arabic}
              </button>
            </div>
          </div>

          {/* Arabic Font Selection */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7V4h16v3M9 20h6M12 4v16" />
              </svg>
              {t.arabicFont}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {(Object.keys(ARABIC_FONTS) as ArabicFont[]).map((fontKey) => (
                <button
                  key={fontKey}
                  style={{
                    padding: '14px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: arabicFont === fontKey ? '2px solid var(--primary)' : '1.5px solid var(--border)',
                    background: arabicFont === fontKey ? 'var(--primary-50)' : 'var(--card)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => changeArabicFont(fontKey)}
                >
                  <span style={{
                    fontFamily: ARABIC_FONTS[fontKey].family,
                    fontSize: '1.1rem',
                    color: arabicFont === fontKey ? 'var(--primary)' : 'var(--text)',
                    fontWeight: 600,
                  }}>
                    بسم الله
                  </span>
                  <span style={{
                    fontSize: '0.7rem',
                    color: arabicFont === fontKey ? 'var(--primary)' : 'var(--text-tertiary)',
                    fontWeight: 500,
                  }}>
                    {language === 'ar' ? ARABIC_FONTS[fontKey].displayNameAr : ARABIC_FONTS[fontKey].displayName}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Reading Mode */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              {t.readingMode}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                style={{
                  padding: '14px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: readingMode === 'pagination' ? '2px solid var(--primary)' : '1.5px solid var(--border)',
                  background: readingMode === 'pagination' ? 'var(--primary-50)' : 'var(--card)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => changeReadingMode('pagination')}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={readingMode === 'pagination' ? 'var(--primary)' : 'var(--text-secondary)'} strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M12 3v18" />
                </svg>
                <span style={{
                  fontSize: '0.8rem',
                  color: readingMode === 'pagination' ? 'var(--primary)' : 'var(--text)',
                  fontWeight: 600,
                }}>
                  {t.paginationMode}
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  color: readingMode === 'pagination' ? 'var(--primary)' : 'var(--text-tertiary)',
                }}>
                  {t.paginationDesc}
                </span>
              </button>
              <button
                style={{
                  padding: '14px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: readingMode === 'scroll' ? '2px solid var(--primary)' : '1.5px solid var(--border)',
                  background: readingMode === 'scroll' ? 'var(--primary-50)' : 'var(--card)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => changeReadingMode('scroll')}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={readingMode === 'scroll' ? 'var(--primary)' : 'var(--text-secondary)'} strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M8 7h8M8 12h8M8 17h8" />
                  <path d="M17 21l0-4M7 21l0-4" />
                </svg>
                <span style={{
                  fontSize: '0.8rem',
                  color: readingMode === 'scroll' ? 'var(--primary)' : 'var(--text)',
                  fontWeight: 600,
                }}>
                  {t.scrollMode}
                </span>
                <span style={{
                  fontSize: '0.65rem',
                  color: readingMode === 'scroll' ? 'var(--primary)' : 'var(--text-tertiary)',
                }}>
                  {t.scrollDesc}
                </span>
              </button>
            </div>
          </div>

          {/* Statistics */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
              {t.statistics}
            </div>
            <div style={{
              display: 'flex',
              gap: '12px',
            }}>
              <div style={{
                flex: 1,
                padding: '12px',
                background: 'var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>{books.length}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>{t.books}</div>
              </div>
              <div style={{
                flex: 1,
                padding: '12px',
                background: 'var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>{pagesStore.length.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>{t.pages}</div>
              </div>
            </div>
          </div>

          {/* Delete Data */}
          <div style={styles.card}>
            <button style={{
              ...styles.btn,
              background: 'var(--accent-red-light)',
              color: 'var(--accent-red)',
              border: '1px solid var(--accent-red)',
              opacity: 0.9,
            }} onClick={async () => {
              if (!confirm(t.deleteAllData + '?')) return;
              booksStore = [];
              volumesStore = [];
              pagesStore = [];
              await clearAllFromDB();
              setBooks([]);
              setSelectedBook(null);
              setVolumes([]);
              setDataVersion(v => v + 1);
              setView('home'); // Navigate to home to show empty state
              showToast(t.dataDeleted);
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
              </svg>
              {t.deleteAllData}
            </button>
          </div>

          {/* Help & Guide */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {t.help}
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '0.85rem' }}>
              {t.userGuideDesc}
            </p>
            <a
              href="guide.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                ...styles.btn,
                ...styles.btnSecondary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                textDecoration: 'none',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              {t.openGuide}
            </a>
          </div>
        </div>

        <Nav view={view} onNavigate={setView} t={t} />
      </div>
    );
  }

  // Home View
  // Categorize books by sect
  const displayBooks = books.filter(b => !b.id.endsWith('_en'));
  const shiaBooks = displayBooks.filter(b => getBookSect(b.id) === 'shia');
  const sunniBooks = displayBooks.filter(b => getBookSect(b.id) === 'sunni');

  // Desktop layout wrapper
  if (isDesktop) {
    return (
      <div style={{ ...responsiveStyles.desktopWrapper, direction: isRTL ? 'rtl' : 'ltr' }}>
        {/* Desktop Sidebar */}
        <Sidebar
          view={view}
          onNavigate={setView}
          t={t}
          isRTL={isRTL}
          booksCount={displayBooks.length}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
        />

        {/* Main Content Area */}
        <main style={responsiveStyles.mainContent}>
          {/* Desktop Header - simplified since sidebar has logo */}
          <header style={{
            ...styles.header,
            ...responsiveStyles.headerResponsive,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h1 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text)',
              margin: 0,
              fontFamily: isRTL ? arabicFontFamily : 'inherit',
            }}>
              {t.home}
            </h1>
            {/* Stats Badge */}
            {displayBooks.length > 0 && (
              <div style={{
                background: 'var(--primary-50)',
                padding: '8px 16px',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                {displayBooks.length} {t.books}
              </div>
            )}
          </header>

          <div style={{ ...styles.content, ...responsiveStyles.contentContainer }}>
            {displayBooks.length === 0 ? (
              <div style={{ ...styles.empty, padding: '80px 20px' }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '20px',
                  background: 'var(--border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px',
                }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
                <p style={{ marginBottom: '20px', fontWeight: 500, fontSize: '1.1rem' }}>{t.noBooks}</p>
                <button style={{ ...styles.btn, width: 'auto', padding: '12px 28px', fontSize: '0.95rem' }} onClick={() => setView('import')}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  {t.importBook}
                </button>
              </div>
            ) : (
              <>
                {/* Shia Books Section */}
                {shiaBooks.length > 0 && (
                  <div style={{ marginBottom: '32px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '16px',
                    }}>
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '10px',
                        background: 'var(--primary-50)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </div>
                      <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                        {t.shiaBooks}
                      </h2>
                      <span style={{
                        background: 'var(--primary-50)',
                        color: 'var(--primary)',
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}>
                        {shiaBooks.length}
                      </span>
                    </div>
                    <div style={responsiveStyles.bookGrid}>
                      {shiaBooks.map(book => {
                        const displayInfo = hasBookMetadata(book.id) ? getBookDisplayName(book.id, language) : { title: book.title, author: book.author || '' };
                        return (
                          <div key={book.id} style={{ ...styles.bookCard, padding: '18px' }} onClick={() => handleBookSelect(book)}>
                            <div style={{
                              width: '44px',
                              height: '44px',
                              borderRadius: '12px',
                              background: 'var(--primary-50)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                              </svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ ...styles.bookTitle, fontFamily: arabicFontFamily, fontSize: '1.05rem' }}>{displayInfo.title}</div>
                              {displayInfo.author && (
                                <div style={{
                                  fontSize: '0.8rem',
                                  color: 'var(--text-secondary)',
                                  marginBottom: '4px',
                                  fontFamily: language === 'ar' ? arabicFontFamily : 'inherit',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {displayInfo.author}
                                </div>
                              )}
                              <div style={styles.bookMeta}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                  <line x1="3" y1="9" x2="21" y2="9" />
                                </svg>
                                {book.volumes} {t.volumes}
                              </div>
                            </div>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sunni Books Section */}
                {sunniBooks.length > 0 && (
                  <div style={{ marginBottom: '32px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '16px',
                    }}>
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '10px',
                        background: 'var(--accent-blue-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2.5">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </div>
                      <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                        {t.sunniBooks}
                      </h2>
                      <span style={{
                        background: 'var(--accent-blue-light)',
                        color: 'var(--accent-blue)',
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}>
                        {sunniBooks.length}
                      </span>
                    </div>
                    <div style={responsiveStyles.bookGrid}>
                      {sunniBooks.map(book => {
                        const displayInfo = hasBookMetadata(book.id) ? getBookDisplayName(book.id, language) : { title: book.title, author: book.author || '' };
                        return (
                          <div key={book.id} style={{ ...styles.bookCard, padding: '18px' }} onClick={() => handleBookSelect(book)}>
                            <div style={{
                              width: '44px',
                              height: '44px',
                              borderRadius: '12px',
                              background: 'var(--accent-blue-light)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                              </svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ ...styles.bookTitle, fontFamily: arabicFontFamily, fontSize: '1.05rem' }}>{displayInfo.title}</div>
                              {displayInfo.author && (
                                <div style={{
                                  fontSize: '0.8rem',
                                  color: 'var(--text-secondary)',
                                  marginBottom: '4px',
                                  fontFamily: language === 'ar' ? arabicFontFamily : 'inherit',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {displayInfo.author}
                                </div>
                              )}
                              <div style={styles.bookMeta}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                  <line x1="3" y1="9" x2="21" y2="9" />
                                </svg>
                                {book.volumes} {t.volumes}
                              </div>
                            </div>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        {/* Toast Notification */}
        {toast && (
          <div style={{
            position: 'fixed',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text)',
            color: 'var(--bg)',
            padding: '14px 24px',
            borderRadius: 'var(--radius)',
            zIndex: 1000,
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.9rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {toast}
          </div>
        )}
      </div>
    );
  }

  // Mobile/Tablet layout
  return (
    <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
      {/* Compact Modern Header */}
      <header style={{ ...styles.header, ...styles.headerHome }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Logo */}
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(5, 150, 105, 0.25)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <path d="M8 7h8M8 11h8M8 15h5" />
            </svg>
          </div>
          <div>
            <h1 style={{ ...styles.headerTitle, fontFamily: isRTL ? arabicFontFamily : 'inherit', margin: 0 }}>{t.appName}</h1>
            <p style={{ ...styles.headerSubtitle, margin: 0 }}>{t.appSubtitle}</p>
          </div>
        </div>
        {/* Stats Badge */}
        {displayBooks.length > 0 && (
          <div style={{
            background: 'var(--primary-50)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {displayBooks.length}
          </div>
        )}
      </header>

      <div style={{ ...styles.content, ...(isTablet ? { padding: '20px 24px' } : {}) }}>
        {displayBooks.length === 0 ? (
          <div style={styles.empty}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'var(--border-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <p style={{ marginBottom: '16px', fontWeight: 500 }}>{t.noBooks}</p>
            <button style={{ ...styles.btn, width: 'auto', padding: '10px 20px' }} onClick={() => setView('import')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              {t.importBook}
            </button>
          </div>
        ) : (
          <>
            {/* Shia Books Section */}
            {shiaBooks.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '12px',
                }}>
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: 'var(--primary-50)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                    {t.shiaBooks}
                  </h2>
                  <span style={{
                    background: 'var(--primary-50)',
                    color: 'var(--primary)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                  }}>
                    {shiaBooks.length}
                  </span>
                </div>
                {shiaBooks.map(book => {
                  const displayInfo = hasBookMetadata(book.id) ? getBookDisplayName(book.id, language) : { title: book.title, author: book.author || '' };
                  return (
                    <div key={book.id} style={styles.bookCard} onClick={() => handleBookSelect(book)}>
                      {/* Book Icon */}
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: 'var(--primary-50)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...styles.bookTitle, fontFamily: arabicFontFamily }}>{displayInfo.title}</div>
                        {displayInfo.author && (
                          <div style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                            marginBottom: '4px',
                            fontFamily: language === 'ar' ? arabicFontFamily : 'inherit',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {displayInfo.author}
                          </div>
                        )}
                        <div style={styles.bookMeta}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                          </svg>
                          {book.volumes} {t.volumes}
                        </div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sunni Books Section */}
            {sunniBooks.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '12px',
                }}>
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: 'var(--accent-blue-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2.5">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                    {t.sunniBooks}
                  </h2>
                  <span style={{
                    background: 'var(--accent-blue-light)',
                    color: 'var(--accent-blue)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                  }}>
                    {sunniBooks.length}
                  </span>
                </div>
                {sunniBooks.map(book => {
                  const displayInfo = hasBookMetadata(book.id) ? getBookDisplayName(book.id, language) : { title: book.title, author: book.author || '' };
                  return (
                    <div key={book.id} style={styles.bookCard} onClick={() => handleBookSelect(book)}>
                      {/* Book Icon */}
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: 'var(--accent-blue-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...styles.bookTitle, fontFamily: arabicFontFamily }}>{displayInfo.title}</div>
                        {displayInfo.author && (
                          <div style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                            marginBottom: '4px',
                            fontFamily: language === 'ar' ? arabicFontFamily : 'inherit',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {displayInfo.author}
                          </div>
                        )}
                        <div style={styles.bookMeta}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                          </svg>
                          {book.volumes} {t.volumes}
                        </div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Nav view={view} onNavigate={setView} t={t} />

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--text)',
          color: 'var(--bg)',
          padding: '12px 20px',
          borderRadius: 'var(--radius)',
          zIndex: 1000,
          boxShadow: 'var(--shadow-lg)',
          fontSize: '0.875rem',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}

// Nav items shared between mobile and desktop
const getNavItems = (t: typeof translations['en']) => [
  { id: 'home' as ViewType, icon: (active: boolean, size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "2"}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      {!active && <polyline points="9 22 9 12 15 12 15 22" />}
    </svg>
  ), label: t.home },
  { id: 'search' as ViewType, match: ['search', 'searchResults'], icon: (active: boolean, size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  ), label: t.search },
  { id: 'import' as ViewType, icon: (active: boolean, size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ), label: t.import },
  { id: 'settings' as ViewType, icon: (active: boolean, size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ), label: t.settings },
];

// Mobile bottom navigation
function Nav({ view, onNavigate, t }: { view: ViewType; onNavigate: (v: ViewType) => void; t: typeof translations['en'] }) {
  const navItems = getNavItems(t);

  return (
    <nav style={styles.nav}>
      {navItems.map(item => {
        const isActive = item.match ? item.match.includes(view) : view === item.id;
        return (
          <button
            key={item.id}
            style={{ ...styles.navBtn, ...(isActive ? styles.navBtnActive : {}) }}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon(isActive)}
            <span style={{ marginTop: '2px' }}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// Desktop sidebar navigation
function Sidebar({
  view,
  onNavigate,
  t,
  isRTL,
  booksCount,
  responsiveStyles,
  arabicFontFamily,
}: {
  view: ViewType;
  onNavigate: (v: ViewType) => void;
  t: typeof translations['en'];
  isRTL: boolean;
  booksCount: number;
  responsiveStyles: Record<string, CSSProperties>;
  arabicFontFamily: string;
}) {
  const navItems = getNavItems(t);

  return (
    <aside style={{ ...responsiveStyles.sidebar, direction: isRTL ? 'rtl' : 'ltr' }}>
      {/* Sidebar Header with Logo */}
      <div style={responsiveStyles.sidebarHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(5, 150, 105, 0.25)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <path d="M8 7h8M8 11h8M8 15h5" />
            </svg>
          </div>
          <div>
            <h1 style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              color: 'var(--text)',
              margin: 0,
              fontFamily: isRTL ? arabicFontFamily : 'inherit',
            }}>
              {t.appName}
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: 0, fontWeight: 500 }}>
              {t.appSubtitle}
            </p>
          </div>
        </div>
        {/* Stats Badge */}
        {booksCount > 0 && (
          <div style={{
            marginTop: '16px',
            background: 'var(--primary-50)',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {booksCount} {t.books}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={responsiveStyles.sidebarNav}>
        {navItems.map(item => {
          const isActive = item.match ? item.match.includes(view) : view === item.id;
          return (
            <button
              key={item.id}
              style={{
                ...responsiveStyles.sidebarNavBtn,
                ...(isActive ? responsiveStyles.sidebarNavBtnActive : {}),
                textAlign: isRTL ? 'right' : 'left',
              }}
              onClick={() => onNavigate(item.id)}
            >
              {item.icon(isActive, 22)}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={responsiveStyles.sidebarFooter}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="8" />
          </svg>
          Hadith Hub v1.0
        </div>
      </div>
    </aside>
  );
}

// Responsive layout wrapper - handles desktop sidebar vs mobile bottom nav
function ResponsiveLayout({
  children,
  view,
  onNavigate,
  t,
  isRTL,
  isDesktop,
  booksCount,
  responsiveStyles,
  arabicFontFamily,
  toast,
  headerTitle,
  headerContent,
  showHeader = true,
}: {
  children: React.ReactNode;
  view: ViewType;
  onNavigate: (v: ViewType) => void;
  t: typeof translations['en'];
  isRTL: boolean;
  isDesktop: boolean;
  booksCount: number;
  responsiveStyles: Record<string, CSSProperties>;
  arabicFontFamily: string;
  toast: string | null;
  headerTitle?: string;
  headerContent?: React.ReactNode;
  showHeader?: boolean;
}) {
  // Desktop layout with sidebar
  if (isDesktop) {
    return (
      <div style={{ ...responsiveStyles.desktopWrapper, direction: isRTL ? 'rtl' : 'ltr' }}>
        <Sidebar
          view={view}
          onNavigate={onNavigate}
          t={t}
          isRTL={isRTL}
          booksCount={booksCount}
          responsiveStyles={responsiveStyles}
          arabicFontFamily={arabicFontFamily}
        />
        <main style={responsiveStyles.mainContent}>
          {showHeader && (
            <header style={{
              ...styles.header,
              ...responsiveStyles.headerResponsive,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              {headerTitle && (
                <h1 style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: 'var(--text)',
                  margin: 0,
                  fontFamily: isRTL ? arabicFontFamily : 'inherit',
                }}>
                  {headerTitle}
                </h1>
              )}
              {headerContent}
            </header>
          )}
          {children}
        </main>
        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text)',
            color: 'var(--bg)',
            padding: '14px 24px',
            borderRadius: 'var(--radius)',
            zIndex: 1000,
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.9rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {toast}
          </div>
        )}
      </div>
    );
  }

  // Mobile/Tablet layout with bottom nav
  return (
    <div style={{ ...styles.app, direction: isRTL ? 'rtl' : 'ltr' }}>
      {children}
      <Nav view={view} onNavigate={onNavigate} t={t} />
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--text)',
          color: 'var(--bg)',
          padding: '12px 20px',
          borderRadius: 'var(--radius)',
          zIndex: 1000,
          boxShadow: 'var(--shadow-lg)',
          fontSize: '0.875rem',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
