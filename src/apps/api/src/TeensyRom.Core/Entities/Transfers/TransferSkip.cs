namespace TeensyRom.Core.Entities.Transfers
{
    /// <summary>Why a file was left out of a transfer. The declaration order is the order skips are reported in.</summary>
    public enum TransferSkipReason
    {
        UnsupportedType,
        HiddenOrSystem,
        PartialDownload
    }

    /// <summary>
    /// A count of files left out for one reason. <paramref name="Types"/> is filled only for
    /// <see cref="TransferSkipReason.UnsupportedType"/>: the distinct lower-case extensions (with the dot), sorted
    /// ordinally, where a name with no extension contributes "(no extension)". Empty for the other reasons.
    /// </summary>
    public sealed record TransferSkip(TransferSkipReason Reason, int Count, IReadOnlyList<string> Types);

    /// <summary>
    /// Collects skips as they happen and reports them as <see cref="TransferSkip"/> entries. Not thread-safe:
    /// the owner serializes access.
    /// </summary>
    public sealed class TransferSkipTally
    {
        public const string NoExtension = "(no extension)";

        private readonly int[] _counts = new int[Enum.GetValues<TransferSkipReason>().Length];
        private readonly SortedSet<string> _types = new(StringComparer.Ordinal);

        public bool IsEmpty => _counts.All(c => c == 0);

        /// <summary>Records one skipped file. <paramref name="path"/> only matters for an unsupported type: its extension is kept.</summary>
        public void Add(TransferSkipReason reason, string path)
        {
            _counts[(int)reason]++;

            if (reason == TransferSkipReason.UnsupportedType)
            {
                var extension = Path.GetExtension(path);
                _types.Add(extension.Length == 0 ? NoExtension : extension.ToLowerInvariant());
            }
        }

        /// <summary>Adds another tally's counts and types into this one.</summary>
        public void Add(TransferSkipTally other)
        {
            for (var i = 0; i < _counts.Length; i++) _counts[i] += other._counts[i];
            _types.UnionWith(other._types);
        }

        public void Clear()
        {
            Array.Clear(_counts);
            _types.Clear();
        }

        /// <summary>The skips in enum order, only those with a count above zero.</summary>
        public IReadOnlyList<TransferSkip> ToSkips() =>
            Enum.GetValues<TransferSkipReason>()
                .Where(reason => _counts[(int)reason] > 0)
                .Select(reason => new TransferSkip(
                    reason,
                    _counts[(int)reason],
                    reason == TransferSkipReason.UnsupportedType ? _types.ToArray() : []))
                .ToArray();
    }

    /// <summary>The one wording every surface uses to say what was left out.</summary>
    public static class TransferSkipWording
    {
        /// <summary>
        /// E.g. "3 files left out (.bin, .xyz): not a file type the TeensyROM takes; 2 hidden or system files left out."
        /// Empty when there are no skips.
        /// </summary>
        public static string Describe(IEnumerable<TransferSkip> skips)
        {
            var parts = skips
                .Where(s => s.Count > 0)
                .OrderBy(s => s.Reason)
                .Select(s => s.Reason switch
                {
                    TransferSkipReason.UnsupportedType =>
                        $"{s.Count} {(s.Count == 1 ? "file" : "files")} left out ({string.Join(", ", s.Types)}): not a file type the TeensyROM takes",
                    TransferSkipReason.HiddenOrSystem =>
                        $"{s.Count} hidden or system {(s.Count == 1 ? "file" : "files")} left out",
                    _ =>
                        $"{s.Count} unfinished {(s.Count == 1 ? "download" : "downloads")} left out"
                })
                .ToList();

            return parts.Count == 0 ? string.Empty : string.Join("; ", parts) + ".";
        }
    }
}
