import { TRANSFER_SKIP_REASONS, TransferSkip } from '@teensyrom-nx/domain';

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

function describeSkip({ reason, count, types }: TransferSkip): string {
  switch (reason) {
    case 'unsupportedType': {
      const typeList = types.length > 0 ? ` (${types.join(', ')})` : '';
      return `${plural(count, 'file', 'files')} left out${typeList}: not a file type the TeensyROM takes`;
    }
    case 'hiddenOrSystem':
      return `${plural(count, 'hidden or system file', 'hidden or system files')} left out`;
    case 'partialDownload':
      return `${plural(count, 'unfinished download', 'unfinished downloads')} left out`;
  }
}

/**
 * The shared "left out" wording for the modal and the end alert, one clause per reason in reason
 * order, or `null` when nothing was left out.
 */
export function describeSkips(skips: TransferSkip[]): string | null {
  const clauses = skips.filter((skip) => skip.count > 0).map(describeSkip);
  return clauses.length === 0 ? null : `${clauses.join('; ')}.`;
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

/** The total number of files the skips cover. */
export function countSkips(skips: TransferSkip[]): number {
  return skips.reduce((sum, skip) => sum + skip.count, 0);
}
