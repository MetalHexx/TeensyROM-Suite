using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;
using TeensyRom.Core.Common;
using TeensyRom.Core.Entities.Storage;

namespace TeensyRom.Api.Endpoints.Files.DeleteFile
{
    /// <summary>
    /// Request model for deleting a file from TeensyROM storage.
    /// </summary>
    public class DeleteFileRequest
    {
        /// <summary>
        /// The unique ID of the TeensyROM device.
        /// </summary>
        [FromRoute]
        public string DeviceId { get; set; } = string.Empty;

        /// <summary>
        /// The storage type where the file is located (SD or USB).
        /// </summary>
        [FromRoute]
        public TeensyStorageType StorageType { get; set; } = TeensyStorageType.SD;

        /// <summary>
        /// The path to the file to delete. Folders and favorite copies are refused.
        /// </summary>
        [FromQuery]
        public string FilePath { get; set; } = string.Empty;
    }

    public class DeleteFileRequestValidator : AbstractValidator<DeleteFileRequest>
    {
        public DeleteFileRequestValidator()
        {
            RuleFor(x => x.DeviceId)
                .NotEmpty().WithMessage("Device ID is required.")
                .Must(deviceId => deviceId.IsValidDeviceId()).WithMessage("Device ID must be 1–32 letters, digits, hyphens, or underscores.");

            RuleFor(x => x.FilePath).Cascade(CascadeMode.Stop)
                .NotEmpty().WithMessage("Path is required.")
                .Must(path => path != "/" && !path.EndsWith('/')).WithMessage("Only files can be deleted.")
                .Must(path => path.IsValidUnixFilePath()).WithMessage("Path must be a valid Unix-style file path.")
                .Must(path => !path.StartsWith("/favorites/", StringComparison.OrdinalIgnoreCase))
                .WithMessage(x => $"{x.FilePath} is a favorite copy. Untag it with unfavorite instead.");

            RuleFor(x => x.StorageType)
                .IsInEnum().WithMessage("Storage type must be a valid enum value.");
        }
    }

    /// <summary>
    /// Response model for the result of a delete file operation.
    /// </summary>
    public class DeleteFileResponse
    {
        /// <summary>
        /// A message indicating the result of the operation.
        /// </summary>
        [Required] public string Message { get; set; } = "Success!";
    }
}
