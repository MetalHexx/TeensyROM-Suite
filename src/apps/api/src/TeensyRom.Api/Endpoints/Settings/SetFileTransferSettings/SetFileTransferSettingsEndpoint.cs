using TeensyRom.Core.Settings;

namespace TeensyRom.Api.Endpoints.Settings.SetFileTransferSettings
{
    public class SetFileTransferSettingsEndpoint(ISettingsService settingsService)
        : RadEndpoint<SetFileTransferSettingsRequest, SetFileTransferSettingsResponse>
    {
        public override void Configure()
        {
            Put("/api/settings/file-transfer")
                .Produces<SetFileTransferSettingsResponse>(StatusCodes.Status200OK)
                .ProducesValidationProblem(StatusCodes.Status400BadRequest)
                .ProducesProblem(StatusCodes.Status500InternalServerError)
                .WithName("SetFileTransferSettings")
                .WithSummary("Set File Transfer Settings")
                .WithTags("Settings")
                .WithDescription(
                    "Changes the file transfer settings and leaves every other section of the settings alone.\n\n" +
                    "- Send only the settings to change; a missing or null value stays as it is.\n" +
                    "- At least one setting is required.\n" +
                    "- Returns all three settings as they are after the change."
                );
        }

        public override Task Handle(SetFileTransferSettingsRequest r, CancellationToken ct)
        {
            var body = r.Body;
            var saveSuccess = settingsService.UpdateSettings(latest => latest with
            {
                FileTransferSettings = latest.FileTransferSettings with
                {
                    AutoLaunchOnCopyEnabled = body.AutoLaunchOnCopyEnabled ?? latest.FileTransferSettings.AutoLaunchOnCopyEnabled,
                    AllFileTypesInFolders = body.AllFileTypesInFolders ?? latest.FileTransferSettings.AllFileTypesInFolders,
                    AllFileTypesInArchives = body.AllFileTypesInArchives ?? latest.FileTransferSettings.AllFileTypesInArchives
                }
            });

            if (!saveSuccess)
            {
                SendExternalError("Failed to save settings to disk. Please check file permissions and try again.");
                return Task.CompletedTask;
            }

            var saved = settingsService.GetSettings().FileTransferSettings;
            Response = new SetFileTransferSettingsResponse
            {
                FileTransferSettings = new FileTransferSettingsDto
                {
                    AutoLaunchOnCopyEnabled = saved.AutoLaunchOnCopyEnabled,
                    AllFileTypesInFolders = saved.AllFileTypesInFolders,
                    AllFileTypesInArchives = saved.AllFileTypesInArchives
                }
            };
            Send();
            return Task.CompletedTask;
        }
    }
}
