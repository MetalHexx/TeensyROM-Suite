using TeensyRom.Api.Endpoints.Common;
using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Endpoints.Files.DeleteFile
{
    public class DeleteFileEndpoint(IDeviceConnectionManager deviceManager, IDeviceTransferLease lease) : RadEndpoint<DeleteFileRequest, DeleteFileResponse>
    {
        public override void Configure()
        {
            Delete("/api/devices/{deviceId}/storage/{storageType}/files")
                .Produces<DeleteFileResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .ProducesProblem(StatusCodes.Status404NotFound)
                .ProducesProblem(StatusCodes.Status409Conflict)
                .ProducesProblem(StatusCodes.Status502BadGateway)
                .WithName("DeleteFile")
                .WithSummary("Delete File")
                .WithDescription(
                    "Deletes one file from the device's storage and drops it from the storage cache.\n\n" +
                    "- Folders can't be deleted, because the firmware removes files only. A folder is refused (400) when the engine's cached listing of its parent knows it. " +
                    "A folder made on the cart outside the engine since that listing was cached isn't known, so the delete reaches the device, the firmware refuses it, and this answers 502 with the device's message.\n" +
                    "- Favorite copies, playlists and bans that name the file are left as they are. A path under /favorites/ is refused (400); untag a favorite with unfavorite instead.\n" +
                    "- Answers 409 (code deviceBusyWithTransfer) when the device is busy with a transfer."
                )
                .WithTags("Files");
        }

        public override async Task Handle(DeleteFileRequest r, CancellationToken ct)
        {
            var device = deviceManager.GetAvailableDevice(r.DeviceId);

            if (device is null)
            {
                SendNotFound($"The device {r.DeviceId} was not found.");
                return;
            }

            IStorageService storage = null!;

            if (r.StorageType is TeensyStorageType.SD)
            {
                if (!device.Cart.SdStorage.Available)
                {
                    SendNotFound($"The device {r.DeviceId} does not have an SD card.");
                    return;
                }
                storage = device.SdStorage;
            }
            else if (r.StorageType is TeensyStorageType.USB)
            {
                if (!device.Cart.UsbStorage.Available)
                {
                    SendNotFound($"The device {r.DeviceId} does not have USB storage.");
                    return;
                }
                storage = device.UsbStorage;
            }

            var result = await storage.DeleteFile(new FilePath(r.FilePath), ct);

            switch (result.Outcome)
            {
                case FileDeleteOutcome.Deleted:
                    Response = new() { Message = $"Deleted {r.FilePath}." };
                    Send();
                    return;

                case FileDeleteOutcome.NotFound:
                    SendNotFound($"The file {r.FilePath} was not found.");
                    return;

                case FileDeleteOutcome.IsDirectory:
                    SendValidationError($"{r.FilePath} is a folder. Only files can be deleted.");
                    return;

                default:
                    if (DeviceBusyProblem.For(lease, r.DeviceId, device.Cart.Name) is { } busy)
                    {
                        SendProblem(busy);
                        return;
                    }
                    SendExternalError(result.Failure ?? "The TeensyROM could not delete the file.");
                    return;
            }
        }
    }
}
