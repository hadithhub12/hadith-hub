export interface Page {
  id?: string; // bookId_vol_page
  bookId: string;
  volume: number;
  page: number;
  text: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  volumes: number;
  description?: string;
  importedAt?: number;
}

export interface VolumeInfo {
  id?: string; // bookId_vol
  bookId: string;
  volume: number;
  totalPages: number;
  importedAt?: number;
}

export interface Translation {
  id?: string; // bookId_vol_page_language
  bookId: string;
  volume: number;
  page: number;
  language: string;
  text: string;
  translatedAt: number;
}

export interface BookManifest {
  id: string;
  title: string;
  author?: string;
  description?: string;
  volumes: {
    volume: number;
    totalPages: number;
  }[];
  createdAt: number;
  version: string;
}

// ZIP file format:
// book.zip
// ├── manifest.json (BookManifest)
// └── volumes/
//     ├── 1/
//     │   ├── 1.txt
//     │   ├── 2.txt
//     │   └── ...
//     ├── 2/
//     └── ...

export type ViewType = 'home' | 'reader' | 'library' | 'import' | 'settings';
