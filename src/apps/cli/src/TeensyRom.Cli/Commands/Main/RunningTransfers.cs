using Spectre.Console;
using Spectre.Console.Rendering;
using TeensyRom.Cli.Api;
using TeensyRom.Cli.Api.Generated;
using TeensyRom.Cli.Helpers;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Commands.Main;

/// <summary>The transfers running now, as the File Transfer and Watch Folders screens show them.</summary>
internal static class RunningTransfers
{
    /// <summary>The "Running transfers" heading and the table of transfers, or "Nothing is being sent.", for the live header of a screen.</summary>
    public static async Task<IRenderable[]> SectionAsync(ITransferService transfers, IDeviceService devices, CancellationToken ct)
    {
        var running = (await transfers.ListAsync(ct)).Where(IsRunning).ToList();
        var names = running.Count == 0
            ? new Dictionary<string, string>()
            : (await devices.GetDevicesAsync(ct)).ToDictionary(device => device.Id, device => device.Name);

        return
        [
            new Markup($"[{RadHelper.Theme.Primary}]Running transfers[/]"),
            running.Count == 0 ? new Markup("Nothing is being sent.") : Build(running, names)
        ];
    }

    public static bool IsRunning(TransferJobDto job) => job.State is TransferJobState.Created or TransferJobState.Receiving or TransferJobState.Sealed;

    public static IRenderable Build(IReadOnlyList<TransferJobDto> jobs, IReadOnlyDictionary<string, string> names)
    {
        var table = new Table().BorderColor(RadHelper.Theme.Secondary.Color).Border(TableBorder.Rounded);

        foreach (var header in new[] { "Device", "From", "Files", "State" }) table.AddColumn(header);

        foreach (var job in jobs)
        {
            table.AddRow(
                new Text(names.GetValueOrDefault(job.DeviceId) ?? job.DeviceId),
                new Text(job.Origin.WatchFolderPath ?? "upload"),
                new Text($"{job.FilesSent} of {job.TotalFiles ?? job.FilesReceived}"),
                new Text(job.State == TransferJobState.Sealed ? "Sending" : "Receiving"));
        }
        return table;
    }
}
