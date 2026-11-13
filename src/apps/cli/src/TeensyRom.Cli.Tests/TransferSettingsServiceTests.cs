using NSubstitute;
using TeensyRom.Cli.Api.Generated;
using TeensyRom.Cli.Services;

namespace TeensyRom.Cli.Tests;

public sealed class TransferSettingsServiceTests
{
    private readonly ITeensyRomApiClient _api = Substitute.For<ITeensyRomApiClient>();
    private readonly TransferSettingsService _sut;

    public TransferSettingsServiceTests() => _sut = new TransferSettingsService(_api);

    private static FileTransferSettingsDto Dto() =>
        new() { AutoLaunchOnCopyEnabled = true, AllFileTypesInFolders = false, AllFileTypesInArchives = true };

    [Fact]
    public async Task Get_MapsTheEnginesNamesToTheUploadSettings()
    {
        _api.GetFileTransferSettingsAsync(Arg.Any<CancellationToken>()).Returns(new GetFileTransferSettingsResponse { FileTransferSettings = Dto() });

        var settings = await _sut.GetAsync(CancellationToken.None);

        settings.Should().Be(new UploadSettings(AutoLaunch: true, AllTypes: false, AllInArchives: true));
    }

    [Fact]
    public async Task Set_SendsOnlyWhatWasGiven_AndReturnsTheSettingsAsTheyAreNow()
    {
        SetFileTransferSettingsBody? body = null;
        _api.SetFileTransferSettingsAsync(Arg.Do<SetFileTransferSettingsBody>(b => body = b), Arg.Any<CancellationToken>())
            .Returns(new SetFileTransferSettingsResponse { FileTransferSettings = Dto() });

        var settings = await _sut.SetAsync(autoLaunch: null, allTypes: true, allInArchives: null, CancellationToken.None);

        body!.AllFileTypesInFolders.Should().BeTrue();
        body.AutoLaunchOnCopyEnabled.Should().BeNull();
        body.AllFileTypesInArchives.Should().BeNull();
        settings.AllInArchives.Should().BeTrue();
    }
}
