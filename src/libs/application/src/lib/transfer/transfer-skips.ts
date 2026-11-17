import {
  TRANSFER_SKIP_NO_EXTENSION,
  TRANSFER_SKIP_REASONS,
  TransferSkip,
} from '@teensyrom-nx/domain';

const HINT_FOLDERS =
  'To send other file types, turn on "All file types in folders" under Uploads in Transfer Settings.';
const HINT_ARCHIVES =
  'To send other file types, turn on "All file types in archives" under Uploads in Transfer Settings.';
const HINT_FOLDERS_AND_ARCHIVES =
  'To send other file types, turn on "All file types in folders" and "All file types in archives" under Uploads in Transfer Settings.';
const HINT_WATCH_FOLDER_ARCHIVES =
  'To send other file types, turn on "All file types in archives" for this watch folder in Transfer Settings.';

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

/** The bracketed type list, with the no-extension marker last; empty when no types are known. */
function typeList(types: string[]): string {
  const names = types.filter((type) => type !== TRANSFER_SKIP_NO_EXTENSION);
  if (types.includes(TRANSFER_SKIP_NO_EXTENSION)) {
    names.push('no extension');
  }
  return names.length > 0 ? ` (${names.join(', ')})` : '';
}

function describeSkipLine({ reason, count, types }: TransferSkip): string {
  switch (reason) {
    case 'unsupportedType':
      return `${plural(count, 'file', 'files')} not a file type the TeensyROM takes${typeList(
        types
      )}`;
    case 'hiddenOrSystem':
      return plural(count, 'hidden or system file', 'hidden or system files');
    case 'partialDownload':
      return plural(count, 'unfinished download', 'unfinished downloads');
  }
}

function describeSkipClause({ reason, count, types }: TransferSkip): string {
  switch (reason) {
    case 'unsupportedType':
      return `${plural(count, 'file', 'files')} skipped${typeList(
        types
      )}: not a file type the TeensyROM takes`;
    case 'hiddenOrSystem':
      return `${plural(count, 'hidden or system file', 'hidden or system files')} skipped`;
    case 'partialDownload':
      return `${plural(count, 'unfinished download', 'unfinished downloads')} skipped`;
  }
}

/** The counted skips, in reason order. */
function countedInReasonOrder(skips: TransferSkip[]): TransferSkip[] {
  return TRANSFER_SKIP_REASONS.flatMap((reason) =>
    skips.filter((skip) => skip.reason === reason && skip.count > 0)
  );
}

function hasUnsupportedType(skips: TransferSkip[]): boolean {
  return skips.some((skip) => skip.reason === 'unsupportedType' && skip.count > 0);
}

/** One bullet line per reason with a count above zero, reason order, no trailing period; [] when nothing was skipped. */
export function describeSkipLines(skips: TransferSkip[]): string[] {
  return countedInReasonOrder(skips).map(describeSkipLine);
}

/** The one-line sentence ("… skipped …; …."), or null when nothing was skipped. */
export function describeSkips(skips: TransferSkip[]): string | null {
  const clauses = countedInReasonOrder(skips).map(describeSkipClause);
  return clauses.length === 0 ? null : `${clauses.join('; ')}.`;
}

/** The hint for unsupported types, or null. `scan` is the drop scan's skips, `job` the job's own. */
export function describeSkipHint(
  scan: TransferSkip[],
  job: TransferSkip[],
  fromWatchFolder: boolean
): string | null {
  const archives = hasUnsupportedType(job);
  if (fromWatchFolder) {
    return archives ? HINT_WATCH_FOLDER_ARCHIVES : null;
  }
  const folders = hasUnsupportedType(scan);
  if (folders && archives) {
    return HINT_FOLDERS_AND_ARCHIVES;
  }
  if (folders) {
    return HINT_FOLDERS;
  }
  return archives ? HINT_ARCHIVES : null;
}

/** Sums counts by reason and unions the types (sorted), returning the reasons in reason order. */
export function mergeSkips(...lists: TransferSkip[][]): TransferSkip[] {
  const merged = new Map<TransferSkip['reason'], { count: number; types: Set<string> }>();
  for (const skip of lists.flat()) {
    const entry = merged.get(skip.reason) ?? { count: 0, types: new Set<string>() };
    entry.count += skip.count;
    skip.types.forEach((type) => entry.types.add(type));
    merged.set(skip.reason, entry);
  }
  return TRANSFER_SKIP_REASONS.filter((reason) => merged.has(reason)).map((reason) => {
    const { count, types } = merged.get(reason)!;
    return { reason, count, types: [...types].sort() };
  });
}
