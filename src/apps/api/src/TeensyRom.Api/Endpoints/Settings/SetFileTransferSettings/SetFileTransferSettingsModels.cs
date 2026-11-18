using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;

namespace TeensyRom.Api.Endpoints.Settings.SetFileTransferSettings
{
    /// <summary>
    /// Request model for changing file transfer settings.
    /// </summary>
    public class SetFileTransferSettingsRequest
    {
        /// <summary>
        /// The JSON request body, bound as a whole.
        /// </summary>
        [FromBody] public SetFileTransferSettingsBody Body { get; set; } = new();
    }

    /// <summary>
    /// The JSON body of a set-file-transfer-settings request. A missing or null value leaves that setting unchanged.
    /// </summary>
    public class SetFileTransferSettingsBody
    {
        /// <summary>
        /// Launch a file after an upload finishes.
        /// </summary>
        public bool? AutoLaunchOnCopyEnabled { get; set; }

        /// <summary>
        /// Send every file in a folder upload, not only known types.
        /// </summary>
        public bool? AllFileTypesInFolders { get; set; }

        /// <summary>
        /// Send everything inside archives, not only known types.
        /// </summary>
        public bool? AllFileTypesInArchives { get; set; }
    }

    public class SetFileTransferSettingsRequestValidator : AbstractValidator<SetFileTransferSettingsRequest>
    {
        public SetFileTransferSettingsRequestValidator()
        {
            RuleFor(x => x.Body)
                .Must(b => b.AutoLaunchOnCopyEnabled is not null || b.AllFileTypesInFolders is not null || b.AllFileTypesInArchives is not null)
                .WithMessage("Give at least one setting to change.");
        }
    }

    /// <summary>
    /// Response model for changed file transfer settings.
    /// </summary>
    public class SetFileTransferSettingsResponse
    {
        /// <summary>The file transfer settings as they are now.</summary>
        [Required] public FileTransferSettingsDto FileTransferSettings { get; set; } = null!;
    }
}
