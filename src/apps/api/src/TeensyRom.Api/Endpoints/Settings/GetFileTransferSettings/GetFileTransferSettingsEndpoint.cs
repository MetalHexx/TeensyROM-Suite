using TeensyRom.Core.Settings;

namespace TeensyRom.Api.Endpoints.Settings.GetFileTransferSettings
{
    public class GetFileTransferSettingsEndpoint(ISettingsService settingsService)
        : RadEndpointWithoutRequest<GetFileTransferSettingsResponse>
    {
        public override void Configure()
        {
            Get("/api/settings/file-transfer")
                .Produces<GetFileTransferSettingsResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status500InternalServerError)
                .WithName("GetFileTransferSettings")
                .WithSummary("Get File Transfer Settings")
                .WithTags("Settings")
                .WithDescription(
                    "Retrieves the file transfer settings alone.\n\n" +
                    "- **Auto-launch**: launch a file after an upload finishes. Watch folders launch by their destination's own switch instead.\n" +
                    "- **All file types in folders**: send every file in a folder upload, not only known types.\n" +
                    "- **All file types in archives**: send everything inside archives, not only known types."
                );
        }

        public override Task Handle(CancellationToken ct)
        {
            var transfer = settingsService.GetSettings().FileTransferSettings;
            Response = new GetFileTransferSettingsResponse
            {
                FileTransferSettings = new FileTransferSettingsDto
                {
                    AutoLaunchOnCopyEnabled = transfer.AutoLaunchOnCopyEnabled,
                    AllFileTypesInFolders = transfer.AllFileTypesInFolders,
                    AllFileTypesInArchives = transfer.AllFileTypesInArchives
                }
            };
            Send();
            return Task.CompletedTask;
        }
    }
}
