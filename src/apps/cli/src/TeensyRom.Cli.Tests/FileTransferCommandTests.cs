using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Spectre.Console;
using Spectre.Console.Cli;
using TeensyRom.Cli.Api.Generated;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Tests;

/// <summary>The File Transfer hub over substituted services, driven by keys on an interactive console. Back is the third choice.</summary>
[Collection(ConsoleCollection.Name)]
public sealed class FileTransferCommandTests : IDisposable
{
    private const int UploadSettings = 0;
    private const int WatchFolders = 1;
    private const int Back = 2;

    private static readonly DeviceSummary Alpha = new("a-1", "Alpha", true, "USB COM3", "Connected", SdAvailable: true);

    private readonly IWatchFolderService _watchFolders = Substitute.For<IWatchFolderService>();
    private readonly ITransferService _transfers = Substitute.For<ITransferService>();
    private readonly ITransferSettingsService _settings = Substitute.For<ITransferSettingsService>();
    private readonly TestHost _host;

    public FileTransferCommandTests()
    {
        _host = new TestHost(terminal: true, configure: services =>
        {
            services.AddSingleton(_watchFolders);
            services.AddSingleton(_transfers);
            services.AddSingleton(_settings);
            services.AddSingleton<ITypeResolver, TypeResolver>();
        });
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha });
        _watchFolders.ListAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<WatchFolderDto>());
        _transfers.ListAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<TransferJobDto>());
        _settings.GetAsync(Arg.Any<CancellationToken>()).Returns(new UploadSettings(false, false, false));
        AnsiConsole.Console = _host.Consoles.Out;
    }

    public void Dispose() => _host.Dispose();

    private string Screen => _host.Consoles.StdOut;

    private void Pick(int index)
    {
        for (var i = 0; i < index; i++) _host.Consoles.Out.Input.PushKey(ConsoleKey.DownArrow);
        _host.Consoles.Out.Input.PushKey(ConsoleKey.Enter);
    }

    private Task<int> Run() => CliHost.CreateTuiApp(_host.Composition.Registrar).RunAsync(["file-transfer"]);

    [Fact]
    public async Task Back_LeavesTheHub_ShowingNothingBeingSent()
    {
        Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("File Transfer").And.Contain("Running transfers").And.Contain("Nothing is being sent.");
    }

    [Fact]
    public async Task TheHub_ShowsOnlyTheTransfersThatAreNotFinished()
    {
        _transfers.ListAsync(Arg.Any<CancellationToken>()).Returns(new[]
        {
            new TransferJobDto { JobId = "j-1", DeviceId = "a-1", State = TransferJobState.Sealed, FilesSent = 3, TotalFiles = 5, Origin = new TransferOriginDto() },
            new TransferJobDto { JobId = "j-2", DeviceId = "a-1", State = TransferJobState.Completed, FilesSent = 9, TotalFiles = 9, Origin = new TransferOriginDto() }
        });
        Pick(Back);

        await Run();

        Screen.Should().Contain("3 of 5").And.Contain("Sending").And.Contain("Alpha").And.NotContain("9 of 9").And.NotContain("Nothing is being sent.");
    }

    [Fact]
    public async Task UploadSettings_OpensItsScreen_ThenReturnsToTheHub()
    {
        Pick(UploadSettings);
        Pick(3);
        Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        var screen = Screen;
        var opened = screen.IndexOf("What an upload from any app sends and launches.", StringComparison.Ordinal);
        opened.Should().BeGreaterThan(-1);
        screen.LastIndexOf("Choose wisely: Back", StringComparison.Ordinal).Should().BeGreaterThan(screen.IndexOf("Choose wisely: Upload Settings", StringComparison.Ordinal));
        await _settings.DidNotReceiveWithAnyArgs().SetAsync(default, default, default, default);
    }

    [Fact]
    public async Task WatchFolders_OpensItsScreen_ThenReturnsToTheHub()
    {
        Pick(WatchFolders);
        Pick(7);
        Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("Send files that land in a folder to your TeensyROM.").And.Contain("No watch folders yet.");
        Screen.Should().Contain("Choose wisely: Watch Folders");
    }
}
