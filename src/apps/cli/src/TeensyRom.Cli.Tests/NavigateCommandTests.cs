using NSubstitute;
using Spectre.Console;
using Spectre.Console.Cli;
using Spectre.Console.Testing;
using TeensyRom.Cli.Commands.Main.Launcher;
using TeensyRom.Cli.Services;
using TeensyRom.Cli.Settings;
using TeensyRom.Cli.Storage.Entities;

namespace TeensyRom.Cli.Tests;

/// <summary>The Launch browser lists only what the TeensyROM can launch, even though the storage listing carries every file.</summary>
[Collection(ConsoleCollection.Name)]
public sealed class NavigateCommandTests : IDisposable
{
    private readonly IAnsiConsole _original = AnsiConsole.Console;
    private readonly TestConsole _console = new TestConsole().Interactive();
    private readonly IStorageService _storage = Substitute.For<IStorageService>();
    private readonly IPlayerService _player = Substitute.For<IPlayerService>();

    public NavigateCommandTests()
    {
        AnsiConsole.Console = _console;
        _player.GetState().Returns(new PlayerState());
        _console.EmitAnsiSequences = false;
    }

    public void Dispose() => AnsiConsole.Console = _original;

    private static FileItem Unknown(string path) => new() { Name = path[(path.LastIndexOf('/') + 1)..], Path = path, IsCompatible = true };

    private static SongItem Song(string path) => new() { Name = path[(path.LastIndexOf('/') + 1)..], Path = path, IsCompatible = true };

    private Task<int> Run()
    {
        var settingsService = Substitute.For<ISettingsService>();
        var settings = new TeensySettings();

        settings.InitializeDefaults();
        settings.AlwaysPromptStorage = false;
        settingsService.GetSettings().Returns(settings);

        var command = new NavigateCommand(_storage, Substitute.For<ITypeResolver>(), _player, settingsService);

        return command.ExecuteAsync(
            new CommandContext([], Substitute.For<IRemainingArguments>(), "nav", null),
            new NavigateSettings { StorageDevice = "sd", StartingPath = "/games" });
    }

    [Fact]
    public async Task AFolderOfOnlyUnknownFiles_IsReportedAsEmpty()
    {
        _storage.GetDirectory("/games").Returns(new DirectoryListing { Path = "/games", Files = [Unknown("/games/a.bin"), Unknown("/games/b.d64x")] });

        var exitCode = await Run();

        exitCode.Should().Be(0);
        _console.Output.Should().Contain("No directories or files found").And.NotContain("a.bin");
    }

    [Fact]
    public async Task AFolderWithBothKinds_OffersOnlyTheLaunchableOnes()
    {
        _storage.GetDirectory("/games").Returns(new DirectoryListing { Path = "/games", Files = [Unknown("/games/a.bin"), Song("/games/z.sid")] });
        _console.Input.PushKey(ConsoleKey.DownArrow);
        _console.Input.PushKey(ConsoleKey.Enter);

        await Run();

        _console.Output.Should().Contain("z.sid").And.NotContain("a.bin");
        await _player.Received(1).LaunchFromDirectory("/games/z.sid");
    }
}
