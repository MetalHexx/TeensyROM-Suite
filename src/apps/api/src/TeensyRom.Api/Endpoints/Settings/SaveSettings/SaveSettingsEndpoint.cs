using TeensyRom.Core.Settings;

namespace TeensyRom.Api.Endpoints.Settings.SaveSettings
{
    public class SaveSettingsEndpoint(ISettingsService settingsService) 
        : RadEndpoint<SaveSettingsRequest, SaveSettingsResponse, SaveSettingsMapper>
    {
        public override void Configure()
        {
            Post("/api/settings")
                .Produces<SaveSettingsResponse>(StatusCodes.Status200OK)
                .ProducesValidationProblem(StatusCodes.Status400BadRequest)
                .ProducesProblem(StatusCodes.Status500InternalServerError)
                .WithName("SaveSettings")
                .WithSummary("Save User Settings")
                .WithTags("Settings")
                .WithDescription(
                    "Saves all user settings for the TeensyROM application to persistent storage.\n\n" +
                    "**Settings Categories:**\n" +
                    "- **Connection Settings**: Device connectivity preferences (Serial/TCP)\n" +
                    "  - Serial: Port name (empty for auto-detect) and baud rate (typically 115200)\n" +
                    "  - TCP: Host address, port (1-65535), and timeout values (milliseconds)\n" +
                    "- **Player Settings**: Playback behavior and startup preferences\n" +
                    "  - Repeat mode, play timer, mute settings, startup filter and launch options\n" +
                    "- **File Transfer Settings**: Accepted but not saved here\n" +
                    "  - The stored transfer settings are kept; change them with `PUT /api/settings/file-transfer`\n" +
                    "- **Search Settings**: Search weights, stop words, and content exclusions\n" +
                    "  - Search weights must be >= 0 with at least one > 0\n" +
                    "  - Stop words, banned directories, and banned files lists\n" +
                    "- **App Settings**: Application lifecycle state\n" +
                    "  - First-time setup flag\n\n" +
                    "**Validation:**\n" +
                    "- All nested settings objects are required\n" +
                    "- Baud rate must be positive (typically 9600, 19200, 38400, 57600, or 115200)\n" +
                    "- TCP port must be between 1 and 65535\n" +
                    "- Timeout values must be positive integers (milliseconds)\n" +
                    "- Search weights must be non-negative with at least one > 0\n\n" +
                    "The stored watch folders and transfer settings are kept as they are. " +
                    "Transfer settings change only through `PUT /api/settings/file-transfer`.\n\n" +
                    "Settings are persisted to Settings.json and immediately available in memory."
                );
        }

        public override Task Handle(SaveSettingsRequest request, CancellationToken ct)
        {
            var settings = Map.ToEntity(request);
            // Watch folders, the settings version and the transfer settings are not changed by this request; take the
            // newest of each under the settings lock so a change that landed since the mapper read the settings is not
            // overwritten (a stale transfer-settings copy would silently revert `trom transfer set`).
            var saveSuccess = settingsService.UpdateSettings(latest => settings with
            {
                WatchFolders = latest.WatchFolders,
                SettingsVersion = latest.SettingsVersion,
                FileTransferSettings = latest.FileTransferSettings
            });

            if (!saveSuccess)
            {
                SendExternalError("Failed to save settings to disk. Please check file permissions and try again.");
                return Task.CompletedTask;
            }

            Response = new SaveSettingsResponse
            {
                Message = "Settings saved successfully."
            };

            Send();
            return Task.CompletedTask;
        }
    }
}
