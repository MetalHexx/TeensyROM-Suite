using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NSubstitute;
using System.Text.Json;
using TeensyRom.Cli.Engine;
using TeensyRom.Cli.Errors;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Tests;

/// <summary><c>trom transfer settings</c> and <c>trom transfer set</c> through the real tree over a substituted settings service.</summary>
[Collection(ConsoleCollection.Name)]
public sealed class TransferSettingsCommandTests : IDisposable
{
    private readonly ITransferSettingsService _settings = Substitute.For<ITransferSettingsService>();
    private readonly List<TestHost> _hosts = [];

    public void Dispose()
    {
        foreach (var host in _hosts) host.Dispose();
    }

    private TestHost NewHost(bool terminal = false)
    {
        var host = new TestHost(terminal, services => services.Replace(ServiceDescriptor.Singleton(_settings)));
        host.Engine.EnsureRunningAsync(Arg.Any<CancellationToken>()).Returns(EngineReady.Ready);
        _hosts.Add(host);
        return host;
    }

    [Fact]
    public async Task Settings_Json_IsTheThreeValuesInCamelCase()
    {
        _settings.GetAsync(Arg.Any<CancellationToken>()).Returns(new UploadSettings(true, false, true));
        var host = NewHost();

        var exitCode = await host.RunAsync("transfer", "settings", "--json");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        var document = JsonDocument.Parse(host.Consoles.StdOut).RootElement;
        document.GetProperty("autoLaunch").GetBoolean().Should().BeTrue();
        document.GetProperty("allTypes").GetBoolean().Should().BeFalse();
        document.GetProperty("allInArchives").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Settings_Plain_IsOneLinePerSetting()
    {
        _settings.GetAsync(Arg.Any<CancellationToken>()).Returns(new UploadSettings(false, true, false));
        var host = NewHost();

        var exitCode = await host.RunAsync("transfer", "settings");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        host.Consoles.StdOut.Trim().ReplaceLineEndings("\n").Should()
            .Be("auto-launch: false\nall-types: true\nall-in-archives: false");
    }

    [Fact]
    public async Task Settings_Human_IsATableWithDescriptions()
    {
        _settings.GetAsync(Arg.Any<CancellationToken>()).Returns(new UploadSettings(false, true, false));
        var host = NewHost(terminal: true);

        var exitCode = await host.RunAsync("transfer", "settings");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        host.Consoles.StdOut.Should().Contain("Setting").And.Contain("Value").And.Contain("Description")
            .And.Contain("all-types").And.Contain("true");
    }

    [Theory]
    [InlineData("auto-launch", true)]
    [InlineData("all-types", true)]
    [InlineData("all-types", false)]
    [InlineData("all-in-archives", true)]
    public async Task Set_ChangesOnlyTheNamedSetting_AndPrintsTheSettingsAsTheyAreNow(string key, bool value)
    {
        _settings.SetAsync(default, default, default, default).ReturnsForAnyArgs(new UploadSettings(false, value, false));
        var host = NewHost();

        var exitCode = await host.RunAsync("transfer", "set", key.ToUpperInvariant(), value ? "True" : "false", "--json");

        exitCode.Should().Be(0, host.Consoles.StdErr);
        await _settings.Received(1).SetAsync(
            key == "auto-launch" ? value : null,
            key == "all-types" ? value : null,
            key == "all-in-archives" ? value : null,
            Arg.Any<CancellationToken>());
        JsonDocument.Parse(host.Consoles.StdOut).RootElement.GetProperty("allTypes").GetBoolean().Should().Be(value);
    }

    [Theory]
    [InlineData("nope", "true", "Unknown setting 'nope'. Valid settings: auto-launch, all-types, all-in-archives")]
    [InlineData("all-types", "maybe", "'maybe' isn't a valid value for all-types. Use true or false")]
    public async Task Set_WithABadKeyOrValue_IsAUsageError_BeforeTheEngineStarts(string key, string value, string message)
    {
        var host = NewHost();

        var exitCode = await host.RunAsync("transfer", "set", key, value);

        exitCode.Should().Be((int)CliExitCode.Usage);
        host.Consoles.StdErr.Should().Contain(message);
        await host.Engine.DidNotReceiveWithAnyArgs().EnsureRunningAsync(default);
        await _settings.DidNotReceiveWithAnyArgs().SetAsync(default, default, default, default);
    }
}
