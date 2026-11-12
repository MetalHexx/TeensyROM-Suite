import { Injectable } from '@angular/core';
import { TransferManifestEntry } from '@teensyrom-nx/domain';
import {
  TRANSFER_SUPPORTED_EXTENSIONS,
  TRANSFER_ARCHIVE_EXTENSIONS,
  TRANSFER_EXCLUDED_FILE_NAMES,
  TRANSFER_PARTIAL_DOWNLOAD_EXTENSIONS,
} from './transfer.constants';

/** How many matches accumulate between `onProgress` ticks, so a large walk stays visibly live. */
const PROGRESS_BATCH_SIZE = 25;

export interface DropScanResult {
  entries: TransferManifestEntry[];
  rootName: string | null;
  /** Number of entries admitted as archives — one per archive file, regardless of its contents. */
  archiveCount: number;
}

export interface DropScanOptions {
  /**
   * Send every non-excluded file found in a folder, not only the supported types. Excluded files
   * (including partial downloads) are never sent from a folder regardless of this flag.
   */
  allFileTypesInFolders: boolean;
}

/**
 * Walks a drag-and-drop payload or a directory-picker `FileList` into a single flat manifest,
 * without reading a byte beyond what `File` handles already carry.
 *
 * Loose files are always admitted. Files found in a folder are dropped when their path below the
 * folder is excluded (hidden, system, or partial-download files), and otherwise admitted when
 * `allFileTypesInFolders` is on or their extension is supported.
 *
 * No DI beyond the decorator, no HTTP - trivially constructible against fake entry trees.
 */
@Injectable({ providedIn: 'root' })
export class DropScanner {
  /**
   * `options` may be a promise: a drop's payload is only readable during the drop event's own
   * turn, so the walk captures it first and only then waits for the options.
   */
  scan(
    input: DataTransferItemList | FileList,
    onProgress: (found: number) => void,
    signal: AbortSignal,
    options: DropScanOptions | Promise<DropScanOptions> = { allFileTypesInFolders: false }
  ): Promise<DropScanResult> {
    return isDataTransferItemList(input)
      ? this.scanDrop(input, onProgress, signal, options)
      : this.scanFileList(input, onProgress, signal, options);
  }

  private async scanDrop(
    items: DataTransferItemList,
    onProgress: (found: number) => void,
    signal: AbortSignal,
    pendingOptions: DropScanOptions | Promise<DropScanOptions>
  ): Promise<DropScanResult> {
    const acc = createAccumulator();
    const progress = createProgressReporter(onProgress);
    let rootName: string | null = null;

    // Synchronous, before any await: the payload is only readable during the drop event's own turn.
    const entries = Array.from(items)
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);
    const options = await pendingOptions;

    for (const entry of entries) {
      if (signal.aborted) break;

      if (entry.isDirectory) {
        if (rootName === null) {
          rootName = entry.name;
        }
        await this.walkDirectory(
          entry as FileSystemDirectoryEntry,
          `${entry.name}/`,
          acc,
          progress,
          signal,
          options
        );
      } else if (entry.isFile) {
        const file = await readFile(entry as FileSystemFileEntry);
        addEntry(acc, file, entry.name, progress);
      }
    }

    progress.flush(acc.entries.length);
    return { entries: sortArchivesFirst(acc.entries), rootName, archiveCount: acc.archiveCount };
  }

  private async scanFileList(
    files: FileList,
    onProgress: (found: number) => void,
    signal: AbortSignal,
    pendingOptions: DropScanOptions | Promise<DropScanOptions>
  ): Promise<DropScanResult> {
    const options = await pendingOptions;
    const acc = createAccumulator();
    const progress = createProgressReporter(onProgress);
    let rootName: string | null = null;

    for (const file of Array.from(files)) {
      if (signal.aborted) break;

      // `webkitRelativePath` from a directory picker already carries the root folder name.
      if (!file.webkitRelativePath) {
        addEntry(acc, file, file.name, progress);
        continue;
      }

      if (rootName === null) {
        rootName = file.webkitRelativePath.split('/')[0];
      }
      addFolderFile(acc, file, file.webkitRelativePath, options, progress);
    }

    progress.flush(acc.entries.length);
    return { entries: sortArchivesFirst(acc.entries), rootName, archiveCount: acc.archiveCount };
  }

  private async walkDirectory(
    directory: FileSystemDirectoryEntry,
    pathPrefix: string,
    acc: ScanAccumulator,
    progress: ProgressReporter,
    signal: AbortSignal,
    options: DropScanOptions
  ): Promise<void> {
    const reader = directory.createReader();

    // `readEntries` returns at most 100 entries per call; it must be drained until empty or a
    // large folder silently truncates.
    while (!signal.aborted) {
      const batch = await readEntries(reader);
      if (batch.length === 0) break;

      for (const child of batch) {
        if (signal.aborted) break;

        if (child.isDirectory) {
          await this.walkDirectory(
            child as FileSystemDirectoryEntry,
            `${pathPrefix}${child.name}/`,
            acc,
            progress,
            signal,
            options
          );
        } else if (child.isFile) {
          const file = await readFile(child as FileSystemFileEntry);
          addFolderFile(acc, file, `${pathPrefix}${child.name}`, options, progress);
        }
      }
    }
  }
}

function isDataTransferItemList(
  input: DataTransferItemList | FileList
): input is DataTransferItemList {
  const first = (input as ArrayLike<{ webkitGetAsEntry?: unknown }>)[0];
  return typeof first?.webkitGetAsEntry === 'function';
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function fileNameOf(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

/** Reads the extension from the file name only, so a folder's dot is never taken for one. */
function extensionOf(relativePath: string): string | null {
  const fileName = fileNameOf(relativePath);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? null : fileName.slice(dotIndex).toLowerCase();
}

function hasSupportedExtension(relativePath: string): boolean {
  const extension = extensionOf(relativePath);
  return extension !== null && TRANSFER_SUPPORTED_EXTENSIONS.has(extension);
}

function isArchiveExtension(relativePath: string): boolean {
  const extension = extensionOf(relativePath);
  return extension !== null && TRANSFER_ARCHIVE_EXTENSIONS.has(extension);
}

/**
 * Whether a path below a folder is one the engine never sends: any `/`-separated segment that
 * starts with `.` or is `__MACOSX`, a file name in `TRANSFER_EXCLUDED_FILE_NAMES`, or a file
 * whose extension is in `TRANSFER_PARTIAL_DOWNLOAD_EXTENSIONS`.
 */
function isExcludedTransferPath(pathBelowRoot: string): boolean {
  const segments = pathBelowRoot.split('/');
  const extension = extensionOf(pathBelowRoot);
  return (
    segments.some((segment) => segment.startsWith('.') || segment.toLowerCase() === '__macosx') ||
    TRANSFER_EXCLUDED_FILE_NAMES.has(segments[segments.length - 1].toLowerCase()) ||
    (extension !== null && TRANSFER_PARTIAL_DOWNLOAD_EXTENSIONS.has(extension))
  );
}

interface ScanAccumulator {
  entries: TransferManifestEntry[];
  archiveCount: number;
}

function createAccumulator(): ScanAccumulator {
  return { entries: [], archiveCount: 0 };
}

/**
 * Admits a file found inside a folder. Only the path below the folder is tested for exclusion:
 * the person named the folder itself, so a dropped `.roms` still sends its contents.
 */
function addFolderFile(
  acc: ScanAccumulator,
  file: File,
  relativePath: string,
  options: DropScanOptions,
  progress: ProgressReporter
): void {
  const pathBelowRoot = relativePath.slice(relativePath.indexOf('/') + 1);
  if (isExcludedTransferPath(pathBelowRoot)) return;
  if (!options.allFileTypesInFolders && !hasSupportedExtension(relativePath)) return;

  addEntry(acc, file, relativePath, progress);
}

function addEntry(
  acc: ScanAccumulator,
  file: File,
  relativePath: string,
  progress: ProgressReporter
): void {
  acc.entries.push({ file, relativePath, sizeBytes: file.size });
  if (isArchiveExtension(relativePath)) {
    acc.archiveCount++;
  }
  progress.report(acc.entries.length);
}

/**
 * Groups every archive entry ahead of every ordinary file, at the end of the scan rather than
 * during it — resorting per batch while walking would cost repeated work for no benefit. `sort`
 * is stable in every engine the app targets, so relative order within each group survives.
 */
function sortArchivesFirst(entries: TransferManifestEntry[]): TransferManifestEntry[] {
  return [...entries].sort((a, b) => {
    const aIsArchive = isArchiveExtension(a.relativePath);
    const bIsArchive = isArchiveExtension(b.relativePath);
    if (aIsArchive === bIsArchive) return 0;
    return aIsArchive ? -1 : 1;
  });
}

interface ProgressReporter {
  report(count: number): void;
  flush(finalCount: number): void;
}

/** Batches `onProgress` ticks so a large walk stays cheap while still visibly moving. */
function createProgressReporter(onProgress: (found: number) => void): ProgressReporter {
  let lastReported = 0;
  return {
    report(count: number): void {
      if (count - lastReported >= PROGRESS_BATCH_SIZE) {
        lastReported = count;
        onProgress(count);
      }
    },
    flush(finalCount: number): void {
      if (finalCount !== lastReported) {
        lastReported = finalCount;
        onProgress(finalCount);
      }
    },
  };
}
