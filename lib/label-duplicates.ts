import {renderLabelPage} from './automatic-label';

export async function labelDigest(data: ArrayBuffer) {
 const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
 return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function labelPageDigest(page: Parameters<typeof renderLabelPage>[0]) {
 const raster = await renderLabelPage(page, 1200);
 return raster.width + 'x' + raster.height + ':' + await labelDigest(raster.data.buffer as ArrayBuffer);
}

type FingerprintedPage = {fileHash: string; pageHash: string | null; page: number};

export function findDuplicatePages<T extends FingerprintedPage>(pages: T[], isIncluded: (page: T) => boolean) {
 const firstByFilePage = new Map<string, T>();
 const firstByAppearance = new Map<string, T>();
 const duplicates = new Map<T, T>();

 // Keep an included copy when possible, then prefer the earliest upload.
 const ordered = [...pages.filter(isIncluded), ...pages.filter(page => !isIncluded(page))];
 for (const page of ordered) {
  const filePageKey = page.fileHash + ':' + page.page;
  const original = firstByFilePage.get(filePageKey) ??
   (page.pageHash ? firstByAppearance.get(page.pageHash) : undefined);
  if (original) duplicates.set(page, original);
  firstByFilePage.set(filePageKey, original ?? page);
  if (page.pageHash) firstByAppearance.set(page.pageHash, original ?? page);
 }
 return duplicates;
}
