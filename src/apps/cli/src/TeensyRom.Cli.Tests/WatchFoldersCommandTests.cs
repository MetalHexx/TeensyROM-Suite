using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Spectre.Console;
using Spectre.Console.Testing;
using TeensyRom.Cli.Api;
using TeensyRom.Cli.Api.Generated;
using TeensyRom.Cli.Services;
using TeensyStorageType = TeensyRom.Cli.Storage.Entities.TeensyStorageType;

namespace TeensyRom.Cli.Tests;

/// <summary>
/// The Watch Folders screen over substituted services, driven by keys and answers queued on an interactive console.
/// Back is the eighth choice, so every script ends by picking it.
/// </summary>
[Collection(ConsoleCollection.Name)]
public sealed class WatchFoldersCommandTests : IDisposable
{
    private const int AddFolder = 0;
    private const int FolderFileTypes = 1;
    private const int AddDestination = 2;
    private const int EditDestination = 3;
    private const int RemoveDestination = 4;
    private const int ToggleFolder = 5;
    private const int RemoveFolder = 6;
    private const int Back = 7;

    private static readonly DeviceSummary Alpha = new("a-1", "Alpha", true, "USB COM3", "Connected", SdAvailable: true);

    private readonly string _folder = Directory.CreateTempSubdirectory("trom-watch-folders-").FullName;
    private readonly IWatchFolderService _watchFolders = Substitute.For<IWatchFolderService>();
    private readonly ITransferService _transfers = Substitute.For<ITransferService>();
    private readonly TestHost _host;
    private readonly Keys _keys;

    public WatchFoldersCommandTests()
    {
        _host = new TestHost(terminal: true, configure: services =>
        {
            services.AddSingleton(_watchFolders);
            services.AddSingleton(_transfers);
        });
        _keys = new Keys(_host.Consoles.Out.Input);
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha });
        _watchFolders.ListAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<WatchFolderDto>());
        AddReports(created: true);
        _transfers.ListAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<TransferJobDto>());
        AnsiConsole.Console = _host.Consoles.Out;
    }

    public void Dispose()
    {
        _host.Dispose();
        Directory.Delete(_folder, recursive: true);
    }

    private string Screen => _host.Consoles.StdOut;

    private string[] ScreenLines => Screen.ReplaceLineEndings("\n").Split('\n');

    /// <summary>Queues what the user would press and type, in order.</summary>
    private sealed class Keys(TestConsoleInput input)
    {
        public Keys Pick(int index)
        {
            for (var i = 0; i < index; i++) input.PushKey(ConsoleKey.DownArrow);
            input.PushKey(ConsoleKey.Enter);
            return this;
        }

        public Keys Enter() => Pick(0);

        public Keys Text(string text)
        {
            input.PushTextWithEnter(text);
            return this;
        }
    }

    private Task<int> Run() => CliHost.CreateTuiApp(_host.Composition.Registrar).RunAsync(["watch-folders"]);

    private WatchFolderDto Watched(bool enabled = true, params string[] deviceIds) => new()
    {
        Id = "wf-1",
        Path = _folder,
        Enabled = enabled,
        State = enabled ? WatchFolderState.Watching : WatchFolderState.Off,
        Destinations = (deviceIds.Length == 0 ? ["a-1"] : deviceIds)
            .Select(id => new WatchFolderDestinationDto { Id = $"d-{id}", DeviceId = id, DeviceName = id == "a-1" ? "Alpha" : id, StorageType = Api.Generated.TeensyStorageType.SD, Path = "/auto-transfer", Launch = true })
            .ToList()
    };

    private void HasFolders(params WatchFolderDto[] folders) =>
        _watchFolders.ListAsync(Arg.Any<CancellationToken>()).Returns(folders);

    private void AddReports(bool created) =>
        _watchFolders.AddAsync(default!, default!, default, default, default, default, default, default)
            .ReturnsForAnyArgs(new AddWatchFolderResponse { Created = created, WatchFolder = Watched() });

    private int AlreadyWatchedNotices => System.Text.RegularExpressions.Regex.Matches(string.Join(' ', ScreenLines.Select(line => line.Trim())), "is already watched").Count;

    [Fact]
    public async Task Back_LeavesTheScreen_WithoutTouchingAnyWatchFolder()
    {
        _keys.Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("Watch Folders").And.Contain("No watch folders yet.").And.Contain("Nothing is being sent.");
        await _watchFolders.DidNotReceiveWithAnyArgs().AddAsync(default!, default!, default, default, default, default, default, default);
        await _watchFolders.DidNotReceiveWithAnyArgs().RemoveAsync(default!, default);
    }

    [Fact]
    public async Task TheScreen_ListsFolders_AndOnlyTheTransfersThatAreNotFinished()
    {
        HasFolders(Watched());
        _transfers.ListAsync(Arg.Any<CancellationToken>()).Returns(new[]
        {
            new TransferJobDto { JobId = "j-1", DeviceId = "a-1", State = TransferJobState.Sealed, FilesSent = 3, TotalFiles = 5, Origin = new TransferOriginDto { WatchFolderPath = _folder } },
            new TransferJobDto { JobId = "j-2", DeviceId = "a-1", State = TransferJobState.Completed, FilesSent = 9, TotalFiles = 9, Origin = new TransferOriginDto() },
            new TransferJobDto { JobId = "j-3", DeviceId = "a-1", State = TransferJobState.Created, FilesReceived = 1, Origin = new TransferOriginDto() }
        });
        _keys.Pick(Back);

        await Run();

        Screen.Should().Contain("Watching").And.Contain("All types").And.Contain("In archives").And.Contain("Alpha").And.Contain("SD").And.Contain("/auto-transfer").And.Contain("Yes")
            .And.Contain("3 of 5").And.Contain("Sending")
            .And.Contain("0 of 1").And.Contain("Receiving").And.Contain("upload")
            .And.NotContain("9 of 9").And.NotContain("Nothing is being sent.");
    }

    [Fact]
    public async Task AddWatchFolder_AsksForTheFolder_TakesTheOnlyDeviceAndStorage_AndUsesTheDefaultDeviceFolder()
    {
        _keys.Pick(AddFolder).Text(_folder).Enter().Enter().Enter().Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).AddAsync(_folder, "a-1", TeensyStorageType.SD, "/auto-transfer", false, false, false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AddWatchFolder_AsksForTheTwoFileTypeAnswers_AndSendsThem()
    {
        _keys.Pick(AddFolder).Text(_folder).Enter().Enter().Enter().Pick(1).Pick(1).Pick(Back);

        await Run();

        await _watchFolders.Received(1).AddAsync(_folder, "a-1", TeensyStorageType.SD, "/auto-transfer", false, false, true, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AddWatchFolder_ForANewFolder_AsksTheFileTypeQuestions_WithoutTheAlreadyWatchedNotice()
    {
        _keys.Pick(AddFolder).Text(_folder).Enter().Enter().Enter().Enter().Pick(Back);

        await Run();

        Screen.Should().Contain("Send all file types?").And.Contain("Send all file types in archives?");
        AlreadyWatchedNotices.Should().Be(0);
    }

    [Theory]
    [InlineData("as typed")]
    [InlineData("trailing separator")]
    [InlineData("different case")]
    public async Task AddWatchFolder_ForAFolderAlreadyWatched_SkipsTheFileTypeQuestions_SaysSo_AndAddsTheDestinationWithBothAnswersOff(string spelling)
    {
        var beta = new DeviceSummary("b-1", "Beta", true, "USB COM4", "Connected", SdAvailable: true);
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha, beta });
        HasFolders(Watched());
        var typed = spelling switch
        {
            "trailing separator" => _folder + Path.DirectorySeparatorChar,
            "different case" when OperatingSystem.IsWindows() => _folder.ToUpperInvariant(),
            _ => _folder
        };
        _keys.Pick(AddFolder).Text(typed).Enter().Enter().Pick(Back);

        await Run();

        AlreadyWatchedNotices.Should().Be(1);
        Screen.Should().NotContain("Send all file types?");
        await _watchFolders.Received(1).AddAsync(Path.GetFullPath(typed), "b-1", TeensyStorageType.SD, "/auto-transfer", false, false, false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AddWatchFolder_WhenTheFolderAppearsBetweenTheLookupAndTheAdd_SaysSoOnceAfterAYesAnswer()
    {
        AddReports(created: false);
        _keys.Pick(AddFolder).Text(_folder).Enter().Enter().Enter().Pick(1).Pick(1).Pick(Back);

        await Run();

        AlreadyWatchedNotices.Should().Be(1);
    }

    [Fact]
    public async Task AddWatchFolder_WhenNoDeviceIsOnline_NeverAsksTheFileTypeQuestions()
    {
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<DeviceSummary>());
        _keys.Pick(AddFolder).Text(_folder).Pick(Back);

        await Run();

        Screen.Should().Contain("No TeensyROM is online").And.NotContain("Send all file types?");
    }

    [Fact]
    public async Task AddWatchFolder_AsksWhichStorage_WhenTheDeviceHasBoth_AndLaunchWhenAnswered()
    {
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha with { UsbAvailable = true } });
        _keys.Pick(AddFolder).Text(_folder).Pick(1).Text("/roms").Pick(1).Enter().Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).AddAsync(_folder, "a-1", TeensyStorageType.USB, "/roms", true, false, false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AddWatchFolder_ForAFolderThatDoesNotExist_ReportsItAndAddsNothing()
    {
        _keys.Pick(AddFolder).Text(Path.Combine(_folder, "nope")).Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("isn't a folder on this computer");
        await _watchFolders.DidNotReceiveWithAnyArgs().AddAsync(default!, default!, default, default, default, default, default, default);
    }

    [Fact]
    public async Task AddDestination_OffersOnlyOnlineDevicesTheFolderLacks()
    {
        var beta = new DeviceSummary("b-1", "Beta", true, "USB COM4", "Connected", SdAvailable: true);
        var gamma = new DeviceSummary("g-1", "Gamma", false, "USB COM5", "Offline", SdAvailable: true);
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha, beta, gamma });
        HasFolders(Watched());
        _keys.Pick(AddDestination).Enter().Enter().Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).AddAsync(_folder, "b-1", TeensyStorageType.SD, "/auto-transfer", false, false, false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AddDestination_NeverAsksTheFileTypeQuestions()
    {
        var beta = new DeviceSummary("b-1", "Beta", true, "USB COM4", "Connected", SdAvailable: true);
        _host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha, beta });
        HasFolders(Watched());
        _keys.Pick(AddDestination).Enter().Enter().Enter().Pick(Back);

        await Run();

        Screen.Should().NotContain("Send all file types?");
    }

    [Fact]
    public async Task AddDestination_WhenEveryOnlineDeviceAlreadyReceivesTheFolder_SaysSo()
    {
        HasFolders(Watched());
        _keys.Pick(AddDestination).Enter().Pick(Back);

        await Run();

        Screen.Should().Contain("Every online TeensyROM already receives this folder.");
        await _watchFolders.DidNotReceiveWithAnyArgs().AddAsync(default!, default!, default, default, default, default, default, default);
    }

    [Fact]
    public async Task FolderFileTypes_UsesTheOnlyFolderWithoutAsking_AndKeepsAnswersAtTheirCurrentValue()
    {
        var folder = Watched();
        folder.AllFileTypesInArchives = true;
        HasFolders(folder);
        _keys.Pick(FolderFileTypes).Pick(1).Enter().Pick(Back);

        await Run();

        Screen.Should().NotContain("Watch folder");
        await _watchFolders.Received(1).SetFileTypesAsync("wf-1", true, true, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task FolderFileTypes_WithSeveralFolders_AsksWhichOne()
    {
        var second = Watched();
        second.Id = "wf-2";
        second.Path = Path.Combine(_folder, "other");
        HasFolders(Watched(), second);
        _keys.Pick(FolderFileTypes).Pick(1).Pick(1).Pick(1).Pick(Back);

        await Run();

        await _watchFolders.Received(1).SetFileTypesAsync("wf-2", true, true, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task FolderFileTypes_WithNoWatchFolders_SaysSo()
    {
        _keys.Pick(FolderFileTypes).Pick(Back);

        await Run();

        Screen.Should().Contain("No watch folders yet.");
        await _watchFolders.DidNotReceiveWithAnyArgs().SetFileTypesAsync(default!, default, default, default);
    }

    [Fact]
    public async Task RemoveDestination_RemovesThePickedDevicesDestinations()
    {
        HasFolders(Watched(true, "a-1", "b-1"));
        _keys.Pick(RemoveDestination).Enter().Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).RemoveDeviceAsync("wf-1", "a-1", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task TurnFolderOnOff_FlipsWhetherTheFolderIsEnabled()
    {
        HasFolders(Watched(enabled: true));
        _keys.Pick(ToggleFolder).Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).SetEnabledAsync("wf-1", false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RemoveWatchFolder_RemovesTheFolder_WhenConfirmed()
    {
        HasFolders(Watched());
        _keys.Pick(RemoveFolder).Enter().Pick(1).Pick(Back);

        await Run();

        await _watchFolders.Received(1).RemoveAsync("wf-1", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RemoveWatchFolder_KeepsTheFolder_WhenNotConfirmed()
    {
        HasFolders(Watched());
        _keys.Pick(RemoveFolder).Enter().Enter().Pick(Back);

        await Run();

        await _watchFolders.DidNotReceiveWithAnyArgs().RemoveAsync(default!, default);
    }

    [Fact]
    public async Task TheFolderPickingActions_SayWhenThereAreNoWatchFolders()
    {
        _keys.Pick(ToggleFolder).Pick(Back);

        await Run();

        Screen.Should().Contain("No watch folders yet.");
        await _watchFolders.DidNotReceiveWithAnyArgs().SetEnabledAsync(default!, default, default);
    }

    [Fact]
    public async Task AFolderWithTwoDestinations_GetsOneRowEach()
    {
        HasFolders(Watched(true, "a-1", "b-1"));
        _keys.Pick(Back);

        await Run();

        Screen.Should().Contain("Send to").And.Contain("Storage").And.Contain("Alpha").And.Contain("b-1");
        ScreenLines.Count(line => line.Contains("/auto-transfer")).Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public async Task TheSections_AreSeparatedByBlankLines()
    {
        HasFolders(Watched());
        _keys.Pick(Back);

        await Run();

        var lines = ScreenLines;
        PrecededByBlank(lines, "Running transfers");
        PrecededByBlank(lines, "Choose wisely: ");
        PrecededByBlank(lines, "Launch", linesAbove: 2);
    }

    [Fact]
    public async Task TheEmptyList_IsSeparatedFromTheHeaderAndTheTransfers()
    {
        _keys.Pick(Back);

        await Run();

        PrecededByBlank(ScreenLines, "No watch folders yet.");
        PrecededByBlank(ScreenLines, "Running transfers");
    }

    private static void PrecededByBlank(string[] lines, string marker, int linesAbove = 1)
    {
        var found = Enumerable.Range(0, lines.Length).Where(i => lines[i].Contains(marker)).ToList();

        found.Should().NotBeEmpty($"the screen should show {marker}");
        foreach (var i in found) lines[i - linesAbove].Should().BeNullOrWhiteSpace();
    }

    [Fact]
    public async Task EditDestination_ChangingTheDeviceFolder_SendsOnlyThePath()
    {
        HasFolders(Watched());
        _keys.Pick(EditDestination).Enter().Text("/games").Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).SetDeviceAsync("wf-1", "a-1", "/games", null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task EditDestination_ChangingLaunch_SendsOnlyTheFlag()
    {
        HasFolders(Watched());
        _keys.Pick(EditDestination).Enter().Enter().Pick(1).Pick(Back);

        await Run();

        await _watchFolders.Received(1).SetDeviceAsync("wf-1", "a-1", null, false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task EditDestination_ChangingBoth_MakesOneCall()
    {
        HasFolders(Watched());
        _keys.Pick(EditDestination).Enter().Text("/games").Pick(1).Pick(Back);

        await Run();

        await _watchFolders.Received(1).SetDeviceAsync("wf-1", "a-1", "/games", false, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task EditDestination_ChangingNothing_MakesNoCall()
    {
        HasFolders(Watched());
        _keys.Pick(EditDestination).Enter().Enter().Enter().Pick(Back);

        await Run();

        Screen.Should().Contain("Nothing changed.");
        await _watchFolders.DidNotReceiveWithAnyArgs().SetDeviceAsync(default!, default!, default, default, default);
    }

    [Fact]
    public async Task EditDestination_WithSeveralDestinations_AsksWhichOne()
    {
        HasFolders(Watched(true, "a-1", "b-1"));
        _keys.Pick(EditDestination).Enter().Pick(1).Text("/x").Enter().Pick(Back);

        await Run();

        await _watchFolders.Received(1).SetDeviceAsync("wf-1", "b-1", "/x", null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task EditDestination_ShowsTheEnginesError_AndTheScreenReturns()
    {
        HasFolders(Watched());
        _watchFolders.SetDeviceAsync(default!, default!, default, default, default)
            .ThrowsAsyncForAnyArgs(new TeensyApiException("tr-web refused the change."));
        _keys.Pick(EditDestination).Enter().Text("/games").Enter().Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("tr-web refused the change.");
    }

    [Fact]
    public async Task AnEngineError_IsShown_AndTheScreenReturns()
    {
        HasFolders(Watched());
        _watchFolders.SetEnabledAsync("wf-1", false, Arg.Any<CancellationToken>()).ThrowsAsync(new TeensyApiException("tr-web stopped answering."));
        _keys.Pick(ToggleFolder).Enter().Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("tr-web stopped answering.");
    }
}
