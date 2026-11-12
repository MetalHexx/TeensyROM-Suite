using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;

namespace TeensyRom.Api.Endpoints.WatchFolders.SetWatchFolderFileTypes
{
    /// <summary>
    /// Request model for changing a watch folder's file-type switches.
    /// </summary>
    public class SetWatchFolderFileTypesRequest
    {
        /// <summary>
        /// The ID of the watch folder.
        /// </summary>
        [FromRoute] public string WatchFolderId { get; set; } = string.Empty;

        /// <summary>
        /// The JSON request body, bound as a whole.
        /// </summary>
        [FromBody] public SetWatchFolderFileTypesBody Body { get; set; } = new();
    }

    /// <summary>
    /// The JSON body of a set-file-types request. A missing or null value leaves that switch as it is.
    /// </summary>
    public class SetWatchFolderFileTypesBody
    {
        /// <summary>
        /// Send every file that lands in the folder, not only known types.
        /// </summary>
        public bool? AllFileTypes { get; set; }

        /// <summary>
        /// Send everything inside archives that land in the folder, not only known types.
        /// </summary>
        public bool? AllFileTypesInArchives { get; set; }
    }

    public class SetWatchFolderFileTypesRequestValidator : AbstractValidator<SetWatchFolderFileTypesRequest>
    {
        public SetWatchFolderFileTypesRequestValidator()
        {
            RuleFor(x => x.WatchFolderId).NotEmpty().WithMessage("Watch folder ID is required.");

            RuleFor(x => x.Body)
                .Must(b => b.AllFileTypes is not null || b.AllFileTypesInArchives is not null)
                .WithMessage("Give at least one file-type switch to change.");
        }
    }

    /// <summary>
    /// Response model for a watch folder whose file-type switches were changed.
    /// </summary>
    public class SetWatchFolderFileTypesResponse
    {
        /// <summary>The watch folder as it is now.</summary>
        [Required] public WatchFolderDto WatchFolder { get; set; } = null!;
    }
}
