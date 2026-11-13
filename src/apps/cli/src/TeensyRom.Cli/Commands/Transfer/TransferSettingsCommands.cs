using Spectre.Console;
using Spectre.Console.Cli;
using System.ComponentModel;
using TeensyRom.Cli.Commands.Common;
using TeensyRom.Cli.Engine;
using TeensyRom.Cli.Helpers;
using TeensyRom.Cli.Output;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Commands.Transfer;

/// <summary>The engine's upload settings as <c>trom transfer settings --json</c> writes them.</summary>
internal sealed record TransferSettingsJson(bool AutoLaunch, bool AllTypes, bool AllInArchives);

/// <summary>Shows upload settings the way <c>transfer settings</c> and <c>transfer set</c> both do.</summary>
internal static class TransferSettingsOutput
{
    public const string AutoLaunchKey = "auto-launch";
    public const string AllTypesKey = "all-types";
    public const string AllInArchivesKey = "all-in-archives";

    public static void Show(ICliOutput output, UploadSettings settings)
    {
        var json = new TransferSettingsJson(settings.AutoLaunch, settings.AllTypes, settings.AllInArchives);

        switch (output.Mode)
        {
            case OutputMode.Json:
                output.Json(json);
                break;
            case OutputMode.Plain:
                output.Fields(
                [
                    (AutoLaunchKey, Bool(json.AutoLaunch)),
                    (AllTypesKey, Bool(json.AllTypes)),
                    (AllInArchivesKey, Bool(json.AllInArchives))
                ]);
                break;
            default:
                output.Out.Write(ToTable(json));
                break;
        }
    }

    private static Table ToTable(TransferSettingsJson settings)
    {
        var table = new Table().BorderColor(RadHelper.Theme.Secondary.Color).Border(TableBorder.Rounded)
            .AddColumn("Setting")
            .AddColumn("Value")
            .AddColumn("Description");

        table.AddRow(new Text(AutoLaunchKey), new Text(Bool(settings.AutoLaunch)), new Text("Launch one file after an upload from any app."));
        table.AddRow(new Text(AllTypesKey), new Text(Bool(settings.AllTypes)), new Text("Send every file in a folder you upload."));
        table.AddRow(new Text(AllInArchivesKey), new Text(Bool(settings.AllInArchives)), new Text("Send everything inside an archive you upload."));

        return table;
    }

    private static string Bool(bool value) => value ? "true" : "false";
}

internal sealed class TransferSettingsShowSettings : TromSettings;

/// <summary><c>trom transfer settings</c>: the engine's upload settings. Needs no device.</summary>
internal sealed class TransferSettingsShowCommand(ICliOutput output, IEngineControl engine, ITransferSettingsService transferSettings)
    : EngineCommand<TransferSettingsShowSettings>(output, engine)
{
    protected override async Task<int> RunAsync(CommandContext context, TransferSettingsShowSettings settings, CancellationToken ct)
    {
        TransferSettingsOutput.Show(Output, await transferSettings.GetAsync(ct));

        return 0;
    }
}

internal sealed class TransferSetSettings : TromSettings
{
    private static readonly string[] Keys = [TransferSettingsOutput.AutoLaunchKey, TransferSettingsOutput.AllTypesKey, TransferSettingsOutput.AllInArchivesKey];

    [CommandArgument(0, "<KEY>")]
    [Description("The setting to change: auto-launch, all-types or all-in-archives.")]
    public string Key { get; set; } = string.Empty;

    [CommandArgument(1, "<VALUE>")]
    [Description("The new value: true or false.")]
    public string Value { get; set; } = string.Empty;

    /// <summary>The key as the verb spells it, whatever case it was typed in.</summary>
    public string NormalizedKey => Key.ToLowerInvariant();

    public override ValidationResult Validate()
    {
        if (!Keys.Contains(NormalizedKey)) return ValidationResult.Error($"Unknown setting '{Key}'. Valid settings: {string.Join(", ", Keys)}.");
        if (!bool.TryParse(Value, out _)) return ValidationResult.Error($"'{Value}' isn't a valid value for {Key}. Use true or false.");

        return base.Validate();
    }
}

/// <summary><c>trom transfer set &lt;KEY&gt; &lt;VALUE&gt;</c>: changes one of the engine's upload settings. Needs no device.</summary>
internal sealed class TransferSetCommand(ICliOutput output, IEngineControl engine, ITransferSettingsService transferSettings)
    : EngineCommand<TransferSetSettings>(output, engine)
{
    protected override async Task<int> RunAsync(CommandContext context, TransferSetSettings settings, CancellationToken ct)
    {
        var value = bool.Parse(settings.Value);
        var key = settings.NormalizedKey;

        var updated = await transferSettings.SetAsync(
            key == TransferSettingsOutput.AutoLaunchKey ? value : null,
            key == TransferSettingsOutput.AllTypesKey ? value : null,
            key == TransferSettingsOutput.AllInArchivesKey ? value : null,
            ct);

        TransferSettingsOutput.Show(Output, updated);

        return 0;
    }
}
