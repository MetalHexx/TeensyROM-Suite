using TeensyRom.Cli.Api.Generated;

namespace TeensyRom.Cli.Commands.File;

/// <summary>A file a folder walk skipped, and why.</summary>
internal sealed record SkippedFile(TransferSkipReason Reason, string Path);

/// <summary>How many files were skipped for one reason; <paramref name="Types"/> is filled only for <see cref="TransferSkipReason.UnsupportedType"/>.</summary>
internal sealed record CopySkipJson(TransferSkipReason Reason, int Count, IReadOnlyList<string>? Types = null);

/// <summary>
/// Counts skipped files by reason, from the local folder walk and from the job's own skips, and words them. Mirrors the
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
    /// E.g. "3 files skipped (.bin, .xyz, no extension): not a file type the TeensyROM takes; 2 hidden or system files skipped."
    /// Empty when nothing was skipped.
    /// </summary>
    public static string Describe(IEnumerable<CopySkipJson> skips)
    {
        var parts = skips
            .Where(skip => skip.Count > 0)
            .OrderBy(skip => skip.Reason)
            .Select(skip => skip.Reason switch
            {
                TransferSkipReason.UnsupportedType =>
                    $"{skip.Count} {(skip.Count == 1 ? "file" : "files")} skipped{TypeParenthetical(skip.Types ?? [])}: not a file type the TeensyROM takes",
                TransferSkipReason.HiddenOrSystem =>
                    $"{skip.Count} hidden or system {(skip.Count == 1 ? "file" : "files")} skipped",
                _ =>
                    $"{skip.Count} unfinished {(skip.Count == 1 ? "download" : "downloads")} skipped"
            })
            .ToList();

        return parts.Count == 0 ? string.Empty : string.Join("; ", parts) + ".";
    }

    /// <summary>
    /// The hint for unsupported types, or empty: folders from the walk, archives from the job's own skips. Nothing is
    /// skipped for its type once <c>--all-types</c> or <c>--all-in-archives</c> is on, so no hint shows then.
    /// </summary>
    public static string Hint(IEnumerable<SkippedFile> walked, IEnumerable<TransferSkipDto> job)
    {
        var folders = walked.Any(file => file.Reason == TransferSkipReason.UnsupportedType);
        var archives = job.Any(skip => skip.Reason == TransferSkipReason.UnsupportedType && skip.Count > 0);

        return (folders, archives) switch
        {
            (true, true) => "To send other file types, add --all-types and --all-in-archives, or turn them on for every upload with 'trom transfer set all-types true' and 'trom transfer set all-in-archives true'.",
            (true, false) => "To send other file types, add --all-types, or turn it on for every upload with 'trom transfer set all-types true'.",
            (false, true) => "To send other file types, add --all-in-archives, or turn it on for every upload with 'trom transfer set all-in-archives true'.",
            _ => string.Empty
        };
    }

    /// <summary>The " (.bin, .xyz)" after "skipped"; nothing when no type is known.</summary>
    private static string TypeParenthetical(IEnumerable<string> types)
    {
        var list = TypeList(types);

        return list.Length == 0 ? string.Empty : $" ({list})";
    }

    /// <summary>The extensions as written, with <see cref="NoExtension"/> worded last as "no extension".</summary>
    private static string TypeList(IEnumerable<string> types)
    {
        var list = types.ToList();
        var named = list.Where(type => type != NoExtension).ToList();

        if (list.Contains(NoExtension)) named.Add("no extension");

        return string.Join(", ", named);
    }

    private static string ExtensionOf(string path)
    {
        var extension = Path.GetExtension(path);

        return extension.Length == 0 ? NoExtension : extension.ToLowerInvariant();
    }
}
