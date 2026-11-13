using TeensyRom.Cli.Api;
using TeensyRom.Cli.Api.Generated;

namespace TeensyRom.Cli.Services;

internal sealed class TransferSettingsService(ITeensyRomApiClient api) : ITransferSettingsService
{
    public async Task<UploadSettings> GetAsync(CancellationToken ct) =>
        ToSettings((await ApiErrors.Call(() => api.GetFileTransferSettingsAsync(ct))).FileTransferSettings);

    public async Task<UploadSettings> SetAsync(bool? autoLaunch, bool? allTypes, bool? allInArchives, CancellationToken ct)
    {
        var body = new SetFileTransferSettingsBody
        {
            AutoLaunchOnCopyEnabled = autoLaunch,
            AllFileTypesInFolders = allTypes,
            AllFileTypesInArchives = allInArchives
        };

        return ToSettings((await ApiErrors.Call(() => api.SetFileTransferSettingsAsync(body, ct))).FileTransferSettings);
    }

    private static UploadSettings ToSettings(FileTransferSettingsDto dto) =>
        new(dto.AutoLaunchOnCopyEnabled, dto.AllFileTypesInFolders, dto.AllFileTypesInArchives);
}
