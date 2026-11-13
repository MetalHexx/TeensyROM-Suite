namespace TeensyRom.Api.Transfers;

/// <summary>
/// Names tr-web never sends, whatever the file-type switches say. The excluded names apply everywhere: folder walks, archive entries and watch folders.
/// The partial-download suffixes apply to folder walks and watch-folder arrivals, not to archive entries.
/// A browser's new partial-download suffix is a one-line addition here.
/// <c>trom</c>'s <c>UploadSources</c> and the web scanner's <c>transfer.constants.ts</c> mirror these lists, so a change here is a change in all three places.
/// </summary>
public static class TransferExclusions
{
    private const string MacArchiveResidueFolder = "__MACOSX";

    public static IReadOnlySet<string> ExcludedFileNames { get; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Thumbs.db", "desktop.ini"
    };

    /// <summary>The suffixes browsers give a file while it downloads: Chrome and Edge write .crdownload, Firefox .part.</summary>
    public static IReadOnlySet<string> PartialDownloadExtensions { get; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ".crdownload", ".part"
    };

    /// <summary>
    /// Whether the '/'- or '\'-separated <paramref name="relativePath"/> is never sent: any segment starts with '.'
    /// (dot-files, dot-folders, Mac "._" files) or is "__MACOSX", or the last segment is in <see cref="ExcludedFileNames"/>.
    /// Empty segments are ignored.
    /// </summary>
    public static bool IsExcluded(string relativePath)
    {
        var segments = relativePath.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) return false;

        return segments.Any(s => s.StartsWith('.') || s.Equals(MacArchiveResidueFolder, StringComparison.OrdinalIgnoreCase))
            || ExcludedFileNames.Contains(segments[^1]);
    }

    /// <summary>Whether <paramref name="path"/> is a browser's unfinished download, judged by its extension.</summary>
    public static bool IsPartialDownload(string path) => PartialDownloadExtensions.Contains(Path.GetExtension(path));
}
