import { TransferSkip } from '@teensyrom-nx/domain';
import { describeSkipHint, describeSkipLines, describeSkips, mergeSkips } from './transfer-skips';

const handTestDrop: TransferSkip[] = [
  { reason: 'unsupportedType', count: 3, types: ['(no extension)', '.bin', '.xyz'] },
  { reason: 'hiddenOrSystem', count: 1, types: [] },
  { reason: 'partialDownload', count: 1, types: [] },
];

const SEND_OTHER_TYPES_FOLDERS =
  'To send other file types, turn on "All file types in folders" under Uploads in Transfer Settings.';
const SEND_OTHER_TYPES_ARCHIVES =
  'To send other file types, turn on "All file types in archives" under Uploads in Transfer Settings.';
const SEND_OTHER_TYPES_BOTH =
  'To send other file types, turn on "All file types in folders" and "All file types in archives" under Uploads in Transfer Settings.';
const SEND_OTHER_TYPES_WATCH_FOLDER =
  'To send other file types, turn on "All file types in archives" for this watch folder in Transfer Settings.';

const unsupported: TransferSkip[] = [{ reason: 'unsupportedType', count: 1, types: ['.xyz'] }];

describe('describeSkipLines', () => {
  it('words the hand-test drop as one bullet line per reason', () => {
    expect(describeSkipLines(handTestDrop)).toEqual([
      '3 files not a file type the TeensyROM takes (.bin, .xyz, no extension)',
      '1 hidden or system file',
      '1 unfinished download',
    ]);
  });

  it('is empty when nothing was skipped', () => {
    expect(describeSkipLines([])).toEqual([]);
    expect(describeSkipLines([{ reason: 'hiddenOrSystem', count: 0, types: [] }])).toEqual([]);
  });

  it('words singular and plural counts', () => {
    expect(
      describeSkipLines([
        { reason: 'unsupportedType', count: 1, types: ['.xyz'] },
        { reason: 'hiddenOrSystem', count: 2, types: [] },
        { reason: 'partialDownload', count: 2, types: [] },
      ])
    ).toEqual([
      '1 file not a file type the TeensyROM takes (.xyz)',
      '2 hidden or system files',
      '2 unfinished downloads',
    ]);
  });

  it('omits the type list when no types are known', () => {
    expect(describeSkipLines([{ reason: 'unsupportedType', count: 2, types: [] }])).toEqual([
      '2 files not a file type the TeensyROM takes',
    ]);
  });

  it('lists the no-extension marker last', () => {
    expect(
      describeSkipLines([
        { reason: 'unsupportedType', count: 2, types: ['(no extension)', '.bin'] },
      ])
    ).toEqual(['2 files not a file type the TeensyROM takes (.bin, no extension)']);
  });
});

describe('describeSkips', () => {
  it('returns null when nothing was skipped', () => {
    expect(describeSkips([])).toBeNull();
    expect(describeSkips([{ reason: 'hiddenOrSystem', count: 0, types: [] }])).toBeNull();
  });

  it('words the hand-test drop as one sentence', () => {
    expect(describeSkips(handTestDrop)).toBe(
      '3 files skipped (.bin, .xyz, no extension): not a file type the TeensyROM takes; 1 hidden or system file skipped; 1 unfinished download skipped.'
    );
  });

  it('words singular and plural counts', () => {
    expect(describeSkips(unsupported)).toBe(
      '1 file skipped (.xyz): not a file type the TeensyROM takes.'
    );
    expect(
      describeSkips([
        { reason: 'unsupportedType', count: 3, types: ['.a', '.b'] },
        { reason: 'hiddenOrSystem', count: 2, types: [] },
        { reason: 'partialDownload', count: 2, types: [] },
      ])
    ).toBe(
      '3 files skipped (.a, .b): not a file type the TeensyROM takes; 2 hidden or system files skipped; 2 unfinished downloads skipped.'
    );
  });

  it('omits the type list when no types are known', () => {
    expect(describeSkips([{ reason: 'unsupportedType', count: 2, types: [] }])).toBe(
      '2 files skipped: not a file type the TeensyROM takes.'
    );
  });
});

describe('describeSkipHint', () => {
  const none: TransferSkip[] = [];

  it('offers the folders setting for unsupported types dropped as a folder', () => {
    expect(describeSkipHint(unsupported, none, false)).toBe(SEND_OTHER_TYPES_FOLDERS);
  });

  it('offers the archives setting for unsupported types in a job archive', () => {
    expect(describeSkipHint(none, unsupported, false)).toBe(SEND_OTHER_TYPES_ARCHIVES);
  });

  it('offers both settings when the folder and the archives both skipped unsupported types', () => {
    expect(describeSkipHint(unsupported, unsupported, false)).toBe(SEND_OTHER_TYPES_BOTH);
  });

  it('offers the watch folder archives setting for a watch-folder job', () => {
    expect(describeSkipHint(none, unsupported, true)).toBe(SEND_OTHER_TYPES_WATCH_FOLDER);
  });

  it('ignores the drop scan for a watch-folder job', () => {
    expect(describeSkipHint(unsupported, none, true)).toBeNull();
  });

  it('is null when nothing was skipped as an unsupported type', () => {
    expect(describeSkipHint(none, none, false)).toBeNull();
    expect(
      describeSkipHint([{ reason: 'hiddenOrSystem', count: 1, types: [] }], none, false)
    ).toBeNull();
    expect(
      describeSkipHint(none, [{ reason: 'unsupportedType', count: 0, types: [] }], true)
    ).toBeNull();
  });
});

describe('mergeSkips', () => {
  it('sums counts, unions sorted types and orders by reason', () => {
    const merged = mergeSkips(
      [
        { reason: 'partialDownload', count: 1, types: [] },
        { reason: 'unsupportedType', count: 2, types: ['.zzz', '.abc'] },
      ],
      [{ reason: 'unsupportedType', count: 1, types: ['.abc', '.mid'] }]
    );
    expect(merged).toEqual([
      { reason: 'unsupportedType', count: 3, types: ['.abc', '.mid', '.zzz'] },
      { reason: 'partialDownload', count: 1, types: [] },
    ]);
  });

  it('lists the no-extension type last once merged with dotted types', () => {
    const merged = mergeSkips(
      [{ reason: 'unsupportedType', count: 2, types: ['.xyz', '(no extension)'] }],
      [{ reason: 'unsupportedType', count: 1, types: ['.bin'] }]
    );
    expect(describeSkips(merged)).toBe(
      '3 files skipped (.bin, .xyz, no extension): not a file type the TeensyROM takes.'
    );
  });

  it('returns an empty list for no input', () => {
    expect(mergeSkips()).toEqual([]);
    expect(mergeSkips([], [])).toEqual([]);
  });
});
