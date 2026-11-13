using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NSubstitute;
using System.Text.Json;
using TeensyRom.Cli.Api;
using TeensyRom.Cli.Api.Generated;
using TeensyRom.Cli.Commands.Common;
using TeensyRom.Cli.Engine;
using TeensyRom.Cli.Errors;
using TeensyRom.Cli.Services;
using TeensyRom.Cli.Storage.Entities;
using TeensyStorageType = TeensyRom.Cli.Storage.Entities.TeensyStorageType;

namespace TeensyRom.Cli.Tests;

/// <summary>
/// <c>trom file favorite|unfavorite|ban|delete</c> through the real tree over a substituted storage service.
/// </summary>
[Collection(ConsoleCollection.Name)]
public sealed class FilePathsCommandTests : IDisposable
{
    private static readonly DeviceSummary Alpha = new("a-1", "Alpha", true, "USB COM3", "Connected", SdAvailable: true, UsbAvailable: true);

    private readonly IStorageService _storage = Substitute.For<IStorageService>();
    private readonly List<TestHost> _hosts = [];
    private TeensyStorageType _storageType = TeensyStorageType.SD;

    public FilePathsCommandTests()
    {
        _storage.StorageType.Returns(_ => _storageType);
        _storage.When(s => s.UseStorage(Arg.Any<TeensyStorageType>())).Do(call => _storageType = call.Arg<TeensyStorageType>());
        _storage.GetFile(Arg.Any<string>()).Returns((ILaunchableItem?)null);
        _storage.BanFile(Arg.Any<string>(), Arg.Any<TeensyStorageType>())
            .Returns(call => new BanResult(Name(call.Arg<string>()), false, $"{Name(call.Arg<string>())} is now banned."));
    }

    public void Dispose()
    {
        foreach (var host in _hosts) host.Dispose();
    }

    private TestHost NewHost(string stdin = "", bool terminal = false)
    {
        var host = new TestHost(terminal, services =>
        {
            services.AddSingleton<IDeviceChooser, DeviceChooser>();
            services.Replace(ServiceDescriptor.Singleton(_storage));
            services.AddSingleton<IStdinPaths>(new StdinPaths(new StringReader(stdin), inputIsTerminal: false));
        });
        host.Engine.EnsureRunningAsync(Arg.Any<CancellationToken>()).Returns(EngineReady.Ready);
        host.Devices.GetDevicesAsync(Arg.Any<CancellationToken>()).Returns(new[] { Alpha });
        host.Devices.SelectedDevice.Returns(Alpha);
        _hosts.Add(host);
        return host;
    }

    private static string Name(string path) => path[(path.LastIndexOf('/') + 1)..];

    private static SongItem Song(string path) => new() { Name = Name(path), Path = path };

    private void Exists(string path) => _storage.GetFile(path).Returns(Song(path));

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    // ---- ban ---------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Ban_BansEveryPathOnTheChosenStorage_WithoutLookingAnyFileUp()
    {
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/a.sid", "/games/b.prg", "--storage", "usb");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        await _storage.Received(1).BanFile("/music/a.sid", TeensyStorageType.USB);
        await _storage.Received(1).BanFile("/games/b.prg", TeensyStorageType.USB);
        await _storage.DidNotReceive().GetFile(Arg.Any<string>());
        await _storage.DidNotReceive().GetDirectory(Arg.Any<string>());
    }

    [Fact]
    public async Task Ban_Json_IsAnArrayOfPerPathResults_WithTheBanDetails()
    {
        _storage.BanFile("/music/b.sid", TeensyStorageType.SD).Returns(new BanResult("b.sid", true, "b.sid was already banned."));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/a.sid", "/music/b.sid", "--json");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        var results = Parse(host.Consoles.StdOut).EnumerateArray().ToArray();
        results.Should().HaveCount(2);
        results[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("path", "ok", "message", "bannedFileName", "alreadyBanned");
        results[0].GetProperty("path").GetString().Should().Be("/music/a.sid");
        results[0].GetProperty("alreadyBanned").GetBoolean().Should().BeFalse();
        results[1].GetProperty("ok").GetBoolean().Should().BeTrue();
        results[1].GetProperty("bannedFileName").GetString().Should().Be("b.sid");
        results[1].GetProperty("alreadyBanned").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Ban_ADash_BansEveryPathFromStdin_AndPipedWritesThePaths()
    {
        var host = NewHost(stdin: "/music/a.sid\n/music/b.sid\n");

        var exitCode = await host.RunAsync("file", "ban", "-");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        await _storage.Received(1).BanFile("/music/a.sid", TeensyStorageType.SD);
        await _storage.Received(1).BanFile("/music/b.sid", TeensyStorageType.SD);
        host.Consoles.StdOut.Replace("\r\n", "\n").Should().Be("/music/a.sid\n/music/b.sid\n");
    }

    [Fact]
    public async Task Ban_ANotFoundAmongSuccesses_BansTheRest_AndExitsNotFound()
    {
        _storage.BanFile("/music/gone.sid", Arg.Any<TeensyStorageType>()).Returns<BanResult>(_ => throw new TeensyApiException("No such file.", 404));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/gone.sid", "/music/a.sid", "--json");

        exitCode.Should().Be((int)CliExitCode.NotFound);
        await _storage.Received(1).BanFile("/music/a.sid", TeensyStorageType.SD);
        var results = Parse(host.Consoles.StdOut).EnumerateArray().ToArray();
        results[0].GetProperty("ok").GetBoolean().Should().BeFalse();
        results[0].GetProperty("message").GetString().Should().Be("No such file.");
        results[1].GetProperty("ok").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Ban_Json_AFailedPath_EndsStderrWithTheJsonErrorObject_AndKeepsStdoutToTheResults()
    {
        _storage.BanFile("/music/gone.sid", Arg.Any<TeensyStorageType>()).Returns<BanResult>(_ => throw new TeensyApiException("No such file.", 404));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/gone.sid", "/music/a.sid", "--json");

        exitCode.Should().Be((int)CliExitCode.NotFound);
        var error = JsonDocument.Parse(host.Consoles.StdErr.TrimEnd().Split('\n')[^1]).RootElement.GetProperty("error");
        error.GetProperty("code").GetString().Should().Be("notFound");
        error.GetProperty("exitCode").GetInt32().Should().Be((int)CliExitCode.NotFound);
        error.GetProperty("message").GetString().Should().Be("1 of 2 paths failed.");
        Parse(host.Consoles.StdOut).GetArrayLength().Should().Be(2);
    }

    [Fact]
    public async Task Ban_Json_AFailureOtherThanNotFound_ReportsItsOwnCodeInTheErrorObject()
    {
        _storage.BanFile("/music/bad.sid", Arg.Any<TeensyStorageType>()).Returns<BanResult>(_ => throw new TeensyApiException("The device is busy.", 500));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/bad.sid", "--json");

        exitCode.Should().Be((int)CliExitCode.Failed);
        var error = JsonDocument.Parse(host.Consoles.StdErr.TrimEnd().Split('\n')[^1]).RootElement.GetProperty("error");
        error.GetProperty("code").GetString().Should().Be("failed");
        error.GetProperty("exitCode").GetInt32().Should().Be((int)CliExitCode.Failed);
        error.GetProperty("message").GetString().Should().Be("1 of 1 paths failed.");
    }

    [Fact]
    public async Task Ban_AFailedPath_WithoutJson_WritesOnlySentencesToStderr()
    {
        _storage.BanFile("/music/gone.sid", Arg.Any<TeensyStorageType>()).Returns<BanResult>(_ => throw new TeensyApiException("No such file.", 404));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/gone.sid");

        exitCode.Should().Be((int)CliExitCode.NotFound);
        host.Consoles.StdErr.Should().Contain("/music/gone.sid: No such file.").And.Contain("1 of 1 paths failed.").And.NotContain("{");
    }

    [Fact]
    public async Task Ban_AnyOtherFailure_WinsOverNotFound()
    {
        _storage.BanFile("/music/gone.sid", Arg.Any<TeensyStorageType>()).Returns<BanResult>(_ => throw new TeensyApiException("No such file.", 404));
        _storage.BanFile("/music/bad.sid", Arg.Any<TeensyStorageType>()).Returns<BanResult>(_ => throw new TeensyApiException("The device is busy.", 500));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "ban", "/music/gone.sid", "/music/bad.sid");

        exitCode.Should().Be((int)CliExitCode.Failed);
        host.Consoles.StdErr.Should().Contain("2 of 2 paths failed.");
    }

    [Fact]
    public async Task Ban_ABadPath_IsAUsageError_AndBansNothing()
    {
        var host = NewHost(stdin: "/music/a.sid\nmusic/b.sid\n");

        var exitCode = await host.RunAsync("file", "ban", "-");

        exitCode.Should().Be((int)CliExitCode.Usage);
        await _storage.DidNotReceiveWithAnyArgs().BanFile(default!, default);
    }

    // ---- favorite / unfavorite ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Favorite_ResolvesEachPathExactly_ThenTagsIt()
    {
        Exists("/music/a.sid");
        Exists("/music/b.sid");
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "favorite", "/music/a.sid", "/music/b.sid", "--json");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        await _storage.Received(1).SaveFavorite(Arg.Is<ILaunchableItem>(item => item.Path == "/music/a.sid"));
        await _storage.Received(1).SaveFavorite(Arg.Is<ILaunchableItem>(item => item.Path == "/music/b.sid"));
        Parse(host.Consoles.StdOut).EnumerateArray().Select(r => r.GetProperty("ok").GetBoolean()).Should().Equal(true, true);
    }

    [Fact]
    public async Task Favorite_AMissingFile_IsReportedAndTheRestStillTagged_ExitingNotFound()
    {
        Exists("/music/b.sid");
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "favorite", "/music/missing.sid", "/music/b.sid", "--json");

        exitCode.Should().Be((int)CliExitCode.NotFound);
        await _storage.Received(1).SaveFavorite(Arg.Is<ILaunchableItem>(item => item.Path == "/music/b.sid"));
        var results = Parse(host.Consoles.StdOut).EnumerateArray().ToArray();
        results[0].GetProperty("ok").GetBoolean().Should().BeFalse();
        results[0].GetProperty("path").GetString().Should().Be("/music/missing.sid");
    }

    [Fact]
    public async Task Unfavorite_ReadsPathsFromStdin_AndUntagsEachFavorite()
    {
        Exists("/favorites/music/a.sid");
        var host = NewHost(stdin: "/favorites/music/a.sid\n");

        var exitCode = await host.RunAsync("file", "unfavorite", "-");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        await _storage.Received(1).RemoveFavorite(Arg.Is<ILaunchableItem>(item => item.Path == "/favorites/music/a.sid"));
    }

    [Fact]
    public async Task Unfavorite_AFailureOtherThanNotFound_ExitsFailed()
    {
        Exists("/favorites/music/a.sid");
        _storage.RemoveFavorite(Arg.Any<ILaunchableItem>()).Returns<Task>(_ => throw new TeensyApiException("The device is busy.", 500));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "unfavorite", "/favorites/music/a.sid");

        exitCode.Should().Be((int)CliExitCode.Failed);
    }

    // ---- delete ------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Delete_InATerminal_AsksOnceNamingTheDeviceStorageAndPaths_ThenDeletesEachOnYes()
    {
        var host = NewHost(terminal: true);
        host.Consoles.Err.Input.PushTextWithEnter("y");

        var exitCode = await host.RunAsync("file", "delete", "/a.prg", "/games/b.prg");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        host.Consoles.StdErr.Should().Contain("Alpha").And.Contain("SD").And.Contain("/a.prg").And.Contain("/games/b.prg");
        await _storage.Received(1).DeleteFile("/a.prg");
        await _storage.Received(1).DeleteFile("/games/b.prg");
    }

    [Fact]
    public async Task Delete_InATerminal_DecliningExitsFailed_AndDeletesNothing()
    {
        var host = NewHost(terminal: true);
        host.Consoles.Err.Input.PushTextWithEnter("n");

        var exitCode = await host.RunAsync("file", "delete", "/a.prg");

        exitCode.Should().Be((int)CliExitCode.Failed);
        host.Consoles.StdErr.Should().Contain("Cancelled; nothing was deleted.");
        await _storage.DidNotReceiveWithAnyArgs().DeleteFile(default!);
    }

    [Fact]
    public async Task Delete_ManyPaths_ListsTenAndCountsTheRest()
    {
        var host = NewHost(terminal: true);
        host.Consoles.Err.Input.PushTextWithEnter("n");
        var paths = Enumerable.Range(1, 12).Select(i => $"/f{i:00}.prg").ToArray();

        await host.RunAsync(["file", "delete", .. paths]);

        host.Consoles.StdErr.Should().Contain("/f10.prg").And.NotContain("/f11.prg").And.Contain("and 2 more");
    }

    [Fact]
    public async Task Delete_WithoutATerminal_IsAUsageError_AndDeletesNothing()
    {
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "delete", "/a.prg");

        exitCode.Should().Be((int)CliExitCode.Usage);
        host.Consoles.StdErr.Should().Contain("Pass --yes to delete files without a terminal to confirm it.");
        await _storage.DidNotReceiveWithAnyArgs().DeleteFile(default!);
    }

    [Fact]
    public async Task Delete_PathsFromStdin_WithoutYes_IsAUsageError_AndDeletesNothing()
    {
        var host = NewHost(stdin: "/a.prg\n/b.prg\n");

        var exitCode = await host.RunAsync("file", "delete", "-");

        exitCode.Should().Be((int)CliExitCode.Usage);
        await _storage.DidNotReceiveWithAnyArgs().DeleteFile(default!);
    }

    [Fact]
    public async Task Delete_Yes_DeletesWithoutAsking_EvenFromStdin()
    {
        var host = NewHost(stdin: "/a.prg\n/b.prg\n");

        var exitCode = await host.RunAsync("file", "delete", "-", "--yes", "--storage", "usb");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        await _storage.Received(1).DeleteFile("/a.prg");
        await _storage.Received(1).DeleteFile("/b.prg");
        _storageType.Should().Be(TeensyStorageType.USB);
    }

    [Fact]
    public async Task Delete_ABadPath_IsAUsageError_BeforeAskingOrDeleting()
    {
        var host = NewHost(terminal: true);

        var exitCode = await host.RunAsync("file", "delete", "a.prg", "-y");

        exitCode.Should().Be((int)CliExitCode.Usage);
        await _storage.DidNotReceiveWithAnyArgs().DeleteFile(default!);
    }

    [Fact]
    public async Task Delete_Json_IsAnArrayOfPerPathResults()
    {
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "delete", "/a.prg", "-y", "--json");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        var results = Parse(host.Consoles.StdOut).EnumerateArray().ToArray();
        results.Should().ContainSingle();
        results[0].EnumerateObject().Select(p => p.Name).Should().Equal("path", "ok", "message");
        results[0].GetProperty("path").GetString().Should().Be("/a.prg");
        results[0].GetProperty("ok").GetBoolean().Should().BeTrue();
        results[0].GetProperty("message").GetString().Should().Be("/a.prg was deleted.");
    }

    [Fact]
    public async Task Delete_ANotFoundAmongSuccesses_DeletesTheRest_AndExitsNotFound()
    {
        _storage.DeleteFile("/gone.prg").Returns<Task>(_ => throw new TeensyApiException("No such file.", 404));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "delete", "/gone.prg", "/a.prg", "-y", "--json");

        exitCode.Should().Be((int)CliExitCode.NotFound);
        await _storage.Received(1).DeleteFile("/a.prg");
        var results = Parse(host.Consoles.StdOut).EnumerateArray().ToArray();
        results[0].GetProperty("ok").GetBoolean().Should().BeFalse();
        results[0].GetProperty("message").GetString().Should().Be("No such file.");
        results[1].GetProperty("ok").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Delete_AFolderAnswering400_OrABusy409_ExitsFailed_WithEachMessagePerPath()
    {
        _storage.DeleteFile("/games").Returns<Task>(_ => throw new TeensyApiException("Only files can be deleted.", 400));
        _storage.DeleteFile("/busy.prg").Returns<Task>(_ => throw new TeensyApiException("The device is busy.", 409));
        _storage.DeleteFile("/gone.prg").Returns<Task>(_ => throw new TeensyApiException("No such file.", 404));
        var host = NewHost();

        var exitCode = await host.RunAsync("file", "delete", "/gone.prg", "/games", "/busy.prg", "/a.prg", "-y");

        exitCode.Should().Be((int)CliExitCode.Failed);
        await _storage.Received(1).DeleteFile("/a.prg");
        host.Consoles.StdErr.Should().Contain("/games: Only files can be deleted.").And.Contain("/busy.prg: The device is busy.")
            .And.Contain("3 of 4 paths failed.");
        host.Consoles.StdOut.Should().Contain("/a.prg");
    }
}
