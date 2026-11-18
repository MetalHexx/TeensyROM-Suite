using Spectre.Console;
using Spectre.Console.Cli;
using System.ComponentModel;
using TeensyRom.Cli.Commands.Common;
using TeensyRom.Cli.Commands.Index;
using TeensyRom.Cli.Common;
using TeensyRom.Cli.Engine;
using TeensyRom.Cli.Helpers;
using TeensyRom.Cli.Output;
using TeensyRom.Cli.Services;
using TeensyRom.Cli.Settings;

namespace TeensyRom.Cli.Commands.File;

internal sealed class FileLsSettings : StorageSettings
{
    [CommandArgument(0, "[PATH]")]
    [Description("The directory to list. Defaults to the root of the storage. Use - to read it from stdin.")]
    public string Path { get; set; } = "/";

    [CommandOption("--full")]
    [Description("Write every file's full metadata in JSON, as file launch does.")]
    public bool Full { get; set; }

    [CommandOption("--refresh")]
    [Description("Re-read this folder and every folder below it from the TeensyROM into the index first; can take minutes for a large folder.")]
    public bool Refresh { get; set; }

    public override ValidationResult Validate()
    {
        var path = FileCommandOptions.ValidatePath(Path);

        return path.Successful ? base.Validate() : path;
    }
}

/// <summary>
/// <c>trom file ls [PATH]</c>: the subdirectories and then the files of one directory. Piped, it writes one path per
/// line, directories with a trailing <c>/</c>. With <c>--refresh</c> the directory and everything below it is re-indexed first,
/// and tr-web's indexing lines go to stderr; stdout holds only the listing.
/// </summary>
internal sealed class FileLsCommand(
    ICliOutput output,
    IEngineControl engine,
    IDeviceChooser chooser,
    IDeviceService devices,
    IStorageService storage,
    ISettingsService settingsService,
    IDeviceLogStream deviceLog,
    IStdinPaths stdin) : DeviceCommand<FileLsSettings>(output, engine, chooser, devices, storage, settingsService)
{
    protected override async Task<int> RunAsync(CommandContext context, FileLsSettings settings, CancellationToken ct)
    {
        var path = FileCommandOptions.ReadPath(stdin, settings.Path);

        if (settings.Refresh) await RefreshAsync(path, ct);

        var listing = await storage.GetDirectory(path);
        var storageName = FileItemJson.StorageName(storage.StorageType);

        var directories = listing.Directories.Select(directory => new DirectoryItemJson(directory.Name, directory.Path, storageName)).ToList();
        var files = listing.Files.Select(file => FileItemJson.From(file, storage.StorageType)).ToList();

        switch (Output.Mode)
        {
            case OutputMode.Json:
                Output.Json(new FileListingJson(path, storageName, directories, FileItemJson.Many(listing.Files, storage.StorageType, settings.Full)));
                break;
            case OutputMode.Plain:
                Output.Lines(directories.Select(directory => directory.Path.EnsureUnixPathEnding()).Concat(files.Select(file => file.Path)));
                break;
            default:
                if (directories.Count + files.Count > 0) Output.Out.Write(ToTable(directories, files));
                break;
        }

        if (directories.Count + files.Count == 0) Output.Notice($"{path} is empty.");

        return 0;
    }

    /// <summary>Has tr-web re-index <paramref name="path"/> and everything below it. Only a full index (the root) counts as having indexed.</summary>
    private async Task RefreshAsync(string path, CancellationToken ct)
    {
        await using var progress = await IndexProgress.FollowAsync(Output, token => deviceLog.FollowAsync(line => IndexProgress.ShowLine(Output, line), token), ct);

        await storage.Index(path);

        if (path == "/") IndexProgress.MarkIndexed(settingsService);
    }

    private static Table ToTable(IReadOnlyList<DirectoryItemJson> directories, IReadOnlyList<FileItemJson> files)
    {
        var table = new Table().BorderColor(RadHelper.Theme.Secondary.Color).Border(TableBorder.Rounded);

        table.AddColumn("Name");
        table.AddColumn("Type");
        table.AddColumn(new TableColumn("Size").RightAligned());

        foreach (var directory in directories) table.AddRow(new Text($"{directory.Name}/"), new Text("dir"), new Text(string.Empty));

        foreach (var file in files) table.AddRow(new Text(file.Name), new Text(file.FileType.ToString()), new Text(FormatSize(file.Size)));

        return table;
    }

    private static string FormatSize(long bytes) => bytes switch
    {
        < 1024 => $"{bytes} B",
        < 1024 * 1024 => $"{bytes / 1024.0:0.#} KB",
        _ => $"{bytes / (1024.0 * 1024.0):0.#} MB"
    };
}
