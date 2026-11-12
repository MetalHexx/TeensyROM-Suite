using Spectre.Console.Cli;
using TeensyRom.Cli.Api;
using TeensyRom.Cli.Helpers;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Commands.Main;

/// <summary>The Upload Settings screen of the menu: the three switches that decide what an upload from any app sends and launches, each flipped as soon as it is chosen.</summary>
internal class UploadSettingsCommand(ITransferSettingsService settings) : AsyncCommand<UploadSettingsMenuSettings>
{
    private const string ToggleAutoLaunch = "Turn Auto Launch On/Off";
    private const string ToggleAllTypes = "Turn All File Types in Folders On/Off";
    private const string ToggleAllInArchives = "Turn All File Types in Archives On/Off";
    private const string Back = "Back";

    private static readonly List<string> Choices = [ToggleAutoLaunch, ToggleAllTypes, ToggleAllInArchives, Back];

    public override async Task<int> ExecuteAsync(CommandContext context, UploadSettingsMenuSettings _)
    {
        string choice;

        do
        {
            RadHelper.WriteMenu("Upload Settings", "What an upload from any app sends and launches.");

            UploadSettings? current = null;

            try
            {
                current = await settings.GetAsync(CancellationToken.None);
                RadHelper.WriteDynamicTable(["Setting", "Value"],
                [
                    ["Auto launch", OnOff(current.AutoLaunch)],
                    ["All file types in folders", OnOff(current.AllTypes)],
                    ["All file types in archives", OnOff(current.AllInArchives)]
                ]);
            }
            catch (TeensyApiException ex)
            {
                RadHelper.WriteError(ex.Message);
            }

            choice = PromptHelper.ChoicePrompt("Choose wisely", Choices);

            if (choice == Back) break;

            try
            {
                var now = current ?? await settings.GetAsync(CancellationToken.None);

                switch (choice)
                {
                    case ToggleAutoLaunch: await settings.SetAsync(!now.AutoLaunch, null, null, CancellationToken.None); break;
                    case ToggleAllTypes: await settings.SetAsync(null, !now.AllTypes, null, CancellationToken.None); break;
                    case ToggleAllInArchives: await settings.SetAsync(null, null, !now.AllInArchives, CancellationToken.None); break;
                }
            }
            catch (TeensyApiException ex)
            {
                RadHelper.WriteError(ex.Message);
            }
        } while (true);

        RadHelper.WriteLine();
        return 0;
    }

    private static string OnOff(bool on) => on ? "On" : "Off";
}
