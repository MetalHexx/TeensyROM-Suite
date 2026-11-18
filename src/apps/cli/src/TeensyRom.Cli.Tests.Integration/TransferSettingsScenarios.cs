using System.Text.Json;

namespace TeensyRom.Cli.Tests.Integration;

/// <summary>
/// <c>transfer set</c> and <c>transfer settings</c> against the real engine. The upload settings are engine-wide, so no
/// device is needed.
/// </summary>
[Collection(RealApiCollection.Name)]
public sealed class TransferSettingsScenarios(SharedApiFixture api)
{
    [Fact]
    public async Task SetAllTypes_IsReadBackByTransferSettings_AndByTheEnginesSettings()
    {
        var original = (await api.Api.GetSettingsAsync()).FileTransferSettings.AllFileTypesInFolders;

        try
        {
            using var set = new CliHarness();
            (await set.RunAsync("transfer", "set", "all-types", (!original).ToString().ToLowerInvariant(), "--json")).Should().Be(0, set.Error);

            using var shown = new CliHarness();
            (await shown.RunAsync("transfer", "settings", "--json")).Should().Be(0, shown.Error);
            using var document = JsonDocument.Parse(shown.Output);

            document.RootElement.GetProperty("allTypes").GetBoolean().Should().Be(!original);
            (await api.Api.GetSettingsAsync()).FileTransferSettings.AllFileTypesInFolders.Should().Be(!original);
        }
        finally
        {
            using var restore = new CliHarness();
            await restore.RunAsync("transfer", "set", "all-types", original.ToString().ToLowerInvariant());
        }
    }
}
