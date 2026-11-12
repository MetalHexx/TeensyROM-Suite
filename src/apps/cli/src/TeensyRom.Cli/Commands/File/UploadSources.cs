using System.Globalization;

namespace TeensyRom.Cli.Commands.File;

/// <summary>One local file to send, and where it goes.</summary>
/// <param name="LocalPath">The file's full path on this computer.</param>
/// <param name="RelativePath">Where it lands under the destination folder: '/'-separated, never rooted, never holding <c>..</c>.</param>
/// <param name="FoundInFolder">Whether a folder walk found it, as opposed to the user naming it.</param>
/// <param name="IsKnownType">Whether the TeensyROM recognizes the file's type.</param>
internal sealed record UploadFile(string LocalPath, string RelativePath, long Size, bool IsArchive, bool FoundInFolder = false, bool IsKnownType = true);

/// <summary>
/// What the named sources come to: the files to send, the named paths that don't exist, the folders that were walked,
/// and how many walked files were left out for their type.
/// </summary>
internal sealed record UploadPlan(
    IReadOnlyList<UploadFile> Files,
    IReadOnlyList<string> NotFound,
    IReadOnlyList<string> Folders,
    int SkippedByType = 0)
{
    public long TotalSize => Files.Sum(file => file.Size);

    /// <summary>True when a folder walk found files of types the TeensyROM doesn't recognize.</summary>
    public bool FoundUnknownTypesInFolders => Files.Any(file => file.FoundInFolder && !file.IsKnownType);

    /// <summary>
    /// <paramref name="allTypes"/> keeps everything; otherwise drops the files found in folders of a type the TeensyROM
    /// doesn't recognize and counts them in <see cref="SkippedByType"/>.
    /// </summary>
    public UploadPlan WithFolderTypes(bool allTypes)
    {
        if (allTypes) return this;

        var kept = Files.Where(file => !file.FoundInFolder || file.IsKnownType).ToList();

        return this with { Files = kept, SkippedByType = SkippedByType + Files.Count - kept.Count };
    }
}

/// <summary>Turns the local paths of <c>trom file upload</c> into the files to send.</summary>
internal static class UploadSources
{
    private static readonly string[] ArchiveExtensions = [".zip", ".7z", ".rar"];

    // The file types the web app's drop zone takes; archives are in because the engine expands them.
    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".sid", ".crt", ".prg", ".p00", ".hex", ".kla", ".koa", ".art", ".aas", ".hpi", ".seq", ".txt", ".d64",
        ".nfo", ".md", ".ocp", ".pic", ".d71", ".d81", ".reu", ".trh", ".zip", ".7z", ".rar"
    };

    // Links are never followed, so a walk can't leave the named folder or loop; hidden and system files stay home.
    private static readonly EnumerationOptions WalkOptions = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReparsePoint
    };

    /// <summary>Whether tr-web expands the file instead of storing it.</summary>
    public static bool IsArchive(string fileName) =>
        ArchiveExtensions.Contains(Path.GetExtension(fileName), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Whether the engine leaves a file at this '/'-separated path out of every upload: a segment that starts with a dot
    /// or is <c>__MACOSX</c>, or a file named <c>Thumbs.db</c> or <c>desktop.ini</c>.
    /// </summary>
    public static bool IsExcluded(string relativePath)
    {
        var segments = relativePath.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);

        if (segments.Length == 0) return false;

        var name = segments[^1];

        return segments.Any(segment => segment.StartsWith('.') || segment.Equals("__MACOSX", StringComparison.OrdinalIgnoreCase))
            || name.Equals("Thumbs.db", StringComparison.OrdinalIgnoreCase)
            || name.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Whether the TeensyROM takes files of this name's type.</summary>
    public static bool IsSupported(string fileName) => SupportedExtensions.Contains(Path.GetExtension(fileName));

    /// <summary>
    /// Walks what <paramref name="named"/> names. A file arrives as its name; a folder arrives as a folder of its own name
    /// with its layout kept, except <c>.</c> (and a folder with no name, a drive root), whose contents arrive directly.
    /// No names at all means the contents of <paramref name="currentFolder"/>. A named file is
    /// always kept, whatever its type. Walked files are kept with their type tagged, except hidden, system, linked and
    /// <see cref="IsExcluded"/> ones, which are skipped without being counted.
    /// </summary>
    /// <param name="currentFolder">What relative names are resolved against.</param>
    public static UploadPlan Resolve(IReadOnlyList<string> named, string currentFolder)
    {
        var files = new List<UploadFile>();
        var notFound = new List<string>();
        var folders = new List<string>();

        foreach (var path in named.Count == 0 ? new[] { "." } : named)
        {
            var full = Path.GetFullPath(path, currentFolder);

            if (System.IO.File.Exists(full))
            {
                files.Add(Describe(full, Path.GetFileName(full)));
            }
            else if (Directory.Exists(full))
            {
                folders.Add(Path.TrimEndingDirectorySeparator(full));

                files.AddRange(Walk(full, ContentsOnly(path, full) ? string.Empty : Path.GetFileName(Path.TrimEndingDirectorySeparator(full))));
            }
            else
            {
                notFound.Add(path);
            }
        }
        return new UploadPlan(files, notFound, folders);
    }

    /// <summary>The size as the confirmation shows it: KB below a megabyte, otherwise MB.</summary>
    public static string FormatSize(long bytes) => bytes < 1024 * 1024
        ? string.Create(CultureInfo.InvariantCulture, $"{bytes / 1024.0:0.#} KB")
        : string.Create(CultureInfo.InvariantCulture, $"{bytes / (1024.0 * 1024.0):0.#} MB");

    private static bool ContentsOnly(string named, string full) =>
        Path.TrimEndingDirectorySeparator(named) == "." || Path.GetFileName(Path.TrimEndingDirectorySeparator(full)).Length == 0;

    private static List<UploadFile> Walk(string root, string prefix) =>
        Directory.EnumerateFiles(root, "*", WalkOptions)
            .Select(file => (File: file, Relative: Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/')))
            .OrderBy(entry => entry.Relative, StringComparer.Ordinal)
            .Select(entry => (entry.File, Landing: prefix.Length == 0 ? entry.Relative : $"{prefix}/{entry.Relative}"))
            .Where(entry => !IsExcluded(entry.Landing))
            .Select(entry => Describe(entry.File, entry.Landing, foundInFolder: true))
            .ToList();

    private static UploadFile Describe(string localPath, string relativePath, bool foundInFolder = false)
    {
        var info = new FileInfo(localPath);

        return new UploadFile(localPath, relativePath, info.Exists ? info.Length : 0, IsArchive(relativePath), foundInFolder, IsSupported(localPath));
    }
}
