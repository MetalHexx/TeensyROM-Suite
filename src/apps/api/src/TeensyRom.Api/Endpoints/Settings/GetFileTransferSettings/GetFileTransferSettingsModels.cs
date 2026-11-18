using System.ComponentModel.DataAnnotations;

namespace TeensyRom.Api.Endpoints.Settings.GetFileTransferSettings
{
    /// <summary>
    /// Response model containing the file transfer settings.
    /// </summary>
    public record GetFileTransferSettingsResponse
    {
        /// <summary>
        /// File transfer preferences.
        /// </summary>
        [Required] public FileTransferSettingsDto FileTransferSettings { get; set; } = null!;
    }
}
