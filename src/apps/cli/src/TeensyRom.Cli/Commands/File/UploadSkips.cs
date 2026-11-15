using TeensyRom.Cli.Api.Generated;

namespace TeensyRom.Cli.Commands.File;

/// <summary>A file a folder walk left out, and why.</summary>
internal sealed record SkippedFile(TransferSkipReason Reason, string Path);

/// <summary>How many files were left out for one reason; <paramref name="Types"/> is filled only for <see cref="TransferSkipReason.UnsupportedType"/>.</summary>
internal sealed record CopySkipJson(TransferSkipReason Reason, int Count, IReadOnlyList<string>? Types = null);

/// <summary>
/// Counts left-out files by reason, from the local folder walk and from the job's own skips, and words them. Mirrors the
/// API's <c>TransferSkipTally</c> and <c>TransferSkipWording</c>, so every surface reads the same.
/// </summary>
internal sealed class SkipTally
{
    private const string NoExtension = "(no extension)";

    private readonly int[] _counts = new int[Enum.GetValues<TransferSkipReason>().Length];
    private readonly SortedSet<string> _types = new(StringComparer.Ordinal);

    public static SkipTally Of(IEnumerable<SkippedFile> walked, IEnumerable<TransferSkipDto> job)
    {
        var tally = new SkipTally();

        foreach (var file in walked)
        {
            tally._counts[(int)file.Reason]++;

            if (file.Reason == TransferSkipReason.UnsupportedType) tally._types.Add(ExtensionOf(file.Path));
        }
        foreach (var skip in job)
        {
            tally._counts[(int)skip.Reason] += skip.Count;

            if (skip.Reason == TransferSkipReason.UnsupportedType) tally._types.UnionWith(skip.Types);
        }
        return tally;
    }

    /// <summary>The skips in reason order, only those with a count above zero.</summary>
    public IReadOnlyList<CopySkipJson> ToSkips() =>
        Enum.GetValues<TransferSkipReason>()
            .Where(reason => _counts[(int)reason] > 0)
            .Select(reason => new CopySkipJson(reason, _counts[(int)reason], reason == TransferSkipReason.UnsupportedType ? _types.ToArray() : null))
            .ToArray();

    /// <summary>
    /// E.g. "3 files left out (.bin, .xyz): not a file type the TeensyROM takes; 2 hidden or system files left out."
    /// Empty when nothing was left out.
    /// </summary>
    public static string Describe(IEnumerable<CopySkipJson> skips)
    {
        var parts = skips
            .Where(skip => skip.Count > 0)
            .OrderBy(skip => skip.Reason)
            .Select(skip => skip.Reason switch
            {
                TransferSkipReason.UnsupportedType =>
                    $"{skip.Count} {(skip.Count == 1 ? "file" : "files")} left out ({string.Join(", ", skip.Types ?? [])}): not a file type the TeensyROM takes",
                TransferSkipReason.HiddenOrSystem =>
                    $"{skip.Count} hidden or system {(skip.Count == 1 ? "file" : "files")} left out",
                _ =>
                    $"{skip.Count} unfinished {(skip.Count == 1 ? "download" : "downloads")} left out"
            })
            .ToList();

        return parts.Count == 0 ? string.Empty : string.Join("; ", parts) + ".";
    }

    private static string ExtensionOf(string path)
    {
        var extension = Path.GetExtension(path);

        return extension.Length == 0 ? NoExtension : extension.ToLowerInvariant();
    }
}
