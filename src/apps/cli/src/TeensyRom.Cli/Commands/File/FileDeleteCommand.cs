using Spectre.Console;
using Spectre.Console.Cli;
using System.ComponentModel;
using TeensyRom.Cli.Commands.Common;
using TeensyRom.Cli.Engine;
using TeensyRom.Cli.Errors;
using TeensyRom.Cli.Output;
using TeensyRom.Cli.Services;
using TeensyRom.Cli.Settings;
using TeensyRom.Cli.Storage.Entities;

namespace TeensyRom.Cli.Commands.File;

/// <summary>The paths to delete, and whether to skip the question.</summary>
internal sealed class FileDeleteSettings : FilePathsSettings
{
    [CommandOption("-y|--yes")]
    [Description("Delete without asking. Required when there is no terminal to ask in, and when paths come from stdin.")]
    public bool Yes { get; set; }
}

/// <summary>
/// <c>trom file delete &lt;PATHS&gt;...</c>: deletes each file on the chosen storage after asking once, unless --yes.
/// The engine refuses folders; its answer becomes that path's failure.
/// </summary>
internal sealed class FileDeleteCommand(
    ICliOutput output,
    IEngineControl engine,
    IDeviceChooser chooser,
    IDeviceService devices,
    IStorageService storage,
    ISettingsService settingsService,
    IStdinPaths stdin) : FilePathsCommand<FileDeleteSettings, FilePathResultJson>(output, engine, chooser, devices, storage, settingsService, stdin)
{
    private const int MaxPathsListed = 10;

    /// <exception cref="CliException"><see cref="CliExitCode.Failed"/> when declined; <see cref="CliExitCode.Usage"/> when there is no terminal to ask in.</exception>
    protected override void BeforeAll(IReadOnlyList<string> paths, FileDeleteSettings settings)
    {
        if (settings.Yes) return;

        if (!Output.CanPrompt) throw new CliException(CliExitCode.Usage, "Pass --yes to delete files without a terminal to confirm it.");

        if (!Output.Err.Confirm(Question(paths), defaultValue: false))
        {
            throw new CliException(CliExitCode.Failed, "Cancelled; nothing was deleted.");
        }
    }

    protected override async Task<FilePathResultJson> ProcessAsync(string path)
    {
        await Storage.DeleteFile(path);

        return new FilePathResultJson(path, true, $"{path} was deleted.");
    }

    protected override FilePathResultJson Failure(string path, string message) => new(path, false, message);

    private string Question(IReadOnlyList<string> paths)
    {
        var storageName = Storage.StorageType == TeensyStorageType.USB ? "USB" : "SD";
        var device = Devices.SelectedDevice?.Name ?? "the TeensyROM";
        var listed = paths.Take(MaxPathsListed).Select(path => $"  {Markup.Escape(path)}");
        var more = paths.Count > MaxPathsListed ? $"\n  and {paths.Count - MaxPathsListed} more" : string.Empty;

        return $"Delete {(paths.Count == 1 ? "this file" : $"these {paths.Count} files")} from {Markup.Escape(device)}'s {storageName} storage?\n{string.Join('\n', listed)}{more}";
    }
}
