using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using Spectre.Console;
using TeensyRom.Cli.Api;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Tests;

/// <summary>The Upload Settings screen over a substituted settings service, driven by keys. Back is the fourth choice.</summary>
[Collection(ConsoleCollection.Name)]
public sealed class UploadSettingsCommandTests : IDisposable
{
    private const int AutoLaunch = 0;
    private const int AllTypes = 1;
    private const int AllInArchives = 2;
    private const int Back = 3;

    private readonly ITransferSettingsService _settings = Substitute.For<ITransferSettingsService>();
    private readonly TestHost _host;

    public UploadSettingsCommandTests()
    {
        _host = new TestHost(terminal: true, configure: services => services.AddSingleton(_settings));
        _settings.GetAsync(Arg.Any<CancellationToken>()).Returns(new UploadSettings(AutoLaunch: true, AllTypes: false, AllInArchives: false));
        AnsiConsole.Console = _host.Consoles.Out;
    }

    public void Dispose() => _host.Dispose();

    private string Screen => _host.Consoles.StdOut;

    private void Pick(int index)
    {
        for (var i = 0; i < index; i++) _host.Consoles.Out.Input.PushKey(ConsoleKey.DownArrow);
        _host.Consoles.Out.Input.PushKey(ConsoleKey.Enter);
    }

    private Task<int> Run() => CliHost.CreateTuiApp(_host.Composition.Registrar).RunAsync(["upload-settings"]);

    [Fact]
    public async Task TheScreen_ShowsEachSwitchOnOrOff_AndChangesNothingOnBack()
    {
        Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("Auto launch").And.Contain("All file types in folders").And.Contain("All file types in archives")
            .And.Contain("On").And.Contain("Off");
        await _settings.DidNotReceiveWithAnyArgs().SetAsync(default, default, default, default);
    }

    [Fact]
    public async Task AutoLaunch_FlipsOnlyItsSwitch_AndTheScreenRedraws()
    {
        Pick(AutoLaunch);
        Pick(Back);

        await Run();

        await _settings.Received(1).SetAsync(false, null, null, Arg.Any<CancellationToken>());
        await _settings.Received(2).GetAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AllTypes_FlipsOnlyItsSwitch()
    {
        Pick(AllTypes);
        Pick(Back);

        await Run();

        await _settings.Received(1).SetAsync(null, true, null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AllInArchives_FlipsOnlyItsSwitch()
    {
        Pick(AllInArchives);
        Pick(Back);

        await Run();

        await _settings.Received(1).SetAsync(null, null, true, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task AnEngineError_IsShown_AndTheScreenStays()
    {
        _settings.SetAsync(default, default, default, default).ThrowsAsyncForAnyArgs(new TeensyApiException("tr-web refused the change."));
        Pick(AllTypes);
        Pick(Back);

        var exitCode = await Run();

        exitCode.Should().Be(0);
        Screen.Should().Contain("tr-web refused the change.");
    }
}
