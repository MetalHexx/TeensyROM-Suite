using Spectre.Console;
using Spectre.Console.Cli;
using Spectre.Console.Rendering;
using TeensyRom.Cli.Helpers;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Commands.Main;

/// <summary>
/// The File Transfer hub of the menu: the transfers running now, kept fresh while the user picks Upload Settings or
/// Watch Folders.
/// </summary>
internal class FileTransferCommand(ITransferService transfers, IDeviceService devices, ITypeResolver resolver) : AsyncCommand<FileTransferMenuSettings>
{
    private const string UploadSettings = "Upload Settings";
    private const string WatchFolders = "Watch Folders";
    private const string Back = "Back";

    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(1);

    private static readonly string[] Choices = [UploadSettings, WatchFolders, Back];

    public override async Task<int> ExecuteAsync(CommandContext context, FileTransferMenuSettings settings)
    {
        string choice;

        do
        {
            choice = await LiveChoicePrompt.ShowAsync(AnsiConsole.Console, "Choose wisely", Choices, BuildHeaderAsync, RefreshInterval, CancellationToken.None);

            switch (choice)
            {
                case UploadSettings: await RunAsync<UploadSettingsCommand, UploadSettingsMenuSettings>(context); break;
                case WatchFolders: await RunAsync<WatchFoldersCommand, WatchFoldersSettings>(context); break;
            }
        } while (choice != Back);

        RadHelper.WriteLine();
        return 0;
    }

    private async Task RunAsync<TCommand, TSettings>(CommandContext context)
        where TCommand : AsyncCommand<TSettings>
        where TSettings : CommandSettings, new()
    {
        var screen = (TCommand)resolver.Resolve(typeof(TCommand))!;

        await screen.ExecuteAsync(context, new TSettings());
    }

    private async Task<IRenderable> BuildHeaderAsync(CancellationToken ct)
    {
        var rows = new List<IRenderable>
        {
            RadHelper.BuildMenu("File Transfer", "Send files from this computer to your TeensyROM."),
            LiveChoicePrompt.BlankLine
        };
        rows.AddRange(await RunningTransfers.SectionAsync(transfers, devices, ct));
        return new Rows(rows);
    }
}
