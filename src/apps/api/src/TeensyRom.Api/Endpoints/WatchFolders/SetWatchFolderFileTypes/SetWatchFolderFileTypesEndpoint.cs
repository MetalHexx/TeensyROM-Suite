using TeensyRom.Api.WatchFolders;
using TeensyRom.Core.Abstractions;

namespace TeensyRom.Api.Endpoints.WatchFolders.SetWatchFolderFileTypes
{
    public class SetWatchFolderFileTypesEndpoint(IWatchFolderStore store, IWatchFolderStatus status, IDeviceConnectionManager devices)
        : RadEndpoint<SetWatchFolderFileTypesRequest, SetWatchFolderFileTypesResponse>
    {
        public override void Configure()
        {
            Put("/api/watch-folders/{watchFolderId}/file-types")
                .Produces<SetWatchFolderFileTypesResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .ProducesProblem(StatusCodes.Status404NotFound)
                .WithName("SetWatchFolderFileTypes")
                .WithSummary("Set Watch Folder File Types")
                .WithDescription(
                    "Changes which files a watch folder sends, without changing its destinations.\n\n" +
                    "- Send only the switches to change; a missing or null value stays as it is.\n" +
                    "- At least one switch is required.\n" +
                    "- Applies to files that land after the change."
                )
                .WithTags("WatchFolders");
        }

        public override Task Handle(SetWatchFolderFileTypesRequest r, CancellationToken ct)
        {
            var folder = store.SetFileTypes(r.WatchFolderId, r.Body.AllFileTypes, r.Body.AllFileTypesInArchives);

            if (folder is null)
            {
                SendNotFound($"No watch folder was found with id {r.WatchFolderId}.");
                return Task.CompletedTask;
            }

            Response = new() { WatchFolder = WatchFolderDto.From(folder, status, devices) };
            Send();

            return Task.CompletedTask;
        }
    }
}
