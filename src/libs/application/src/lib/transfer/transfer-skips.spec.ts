import { TransferSkip } from '@teensyrom-nx/domain';
import { describeSkips, mergeSkips } from './transfer-skips';

describe('describeSkips', () => {
  it('returns null when nothing was left out', () => {
    expect(describeSkips([])).toBeNull();
    expect(describeSkips([{ reason: 'hiddenOrSystem', count: 0, types: [] }])).toBeNull();
  });

  it('words each reason, singular and plural, in order', () => {
    const skips: TransferSkip[] = [
      { reason: 'unsupportedType', count: 1, types: ['.xyz'] },
      { reason: 'hiddenOrSystem', count: 1, types: [] },
      { reason: 'partialDownload', count: 1, types: ['.part'] },
    ];
    expect(describeSkips(skips)).toBe(
      '1 file left out (.xyz): not a file type the TeensyROM takes; 1 hidden or system file left out; 1 unfinished download left out.'
    );
    expect(
      describeSkips([
        { reason: 'unsupportedType', count: 3, types: ['.a', '.b'] },
        { reason: 'hiddenOrSystem', count: 2, types: [] },
        { reason: 'partialDownload', count: 2, types: [] },
      ])
    ).toBe(
      '3 files left out (.a, .b): not a file type the TeensyROM takes; 2 hidden or system files left out; 2 unfinished downloads left out.'
    );
  });

  it('omits the type list when no types are known', () => {
    expect(describeSkips([{ reason: 'unsupportedType', count: 2, types: [] }])).toBe(
      '2 files left out: not a file type the TeensyROM takes.'
    );
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

  it('keeps the no-extension type ahead of the dotted ones, as the API and trom word it', () => {
    const merged = mergeSkips(
      [{ reason: 'unsupportedType', count: 2, types: ['.xyz', '(no extension)'] }],
      [{ reason: 'unsupportedType', count: 1, types: ['.bin'] }]
    );
    expect(describeSkips(merged)).toBe(
      '3 files left out ((no extension), .bin, .xyz): not a file type the TeensyROM takes.'
    );
  });

  it('returns an empty list for no input', () => {
    expect(mergeSkips()).toEqual([]);
    expect(mergeSkips([], [])).toEqual([]);
  });
});
