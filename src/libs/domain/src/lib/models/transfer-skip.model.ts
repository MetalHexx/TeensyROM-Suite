/** Why a file was left out of a transfer, mirroring the API's TransferSkipReason (camelCased). */
export type TransferSkipReason = 'unsupportedType' | 'hiddenOrSystem' | 'partialDownload';

/** Every reason, in the order a skip report lists them. */
export const TRANSFER_SKIP_REASONS: readonly TransferSkipReason[] = [
  'unsupportedType',
  'hiddenOrSystem',
  'partialDownload',
];

/** The type a skipped file with no extension contributes, as the API and `trom` name it. */
export const TRANSFER_SKIP_NO_EXTENSION = '(no extension)';

/**
 * A count of files left out for one reason; `types` are the extensions involved (e.g. `.xyz`, or
 * `TRANSFER_SKIP_NO_EXTENSION` for a name with none), only for `unsupportedType`.
 */
export interface TransferSkip {
  reason: TransferSkipReason;
  count: number;
  types: string[];
}
