using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using TeensyRom.Api.Endpoints.Transfers.CreateJob;
using TeensyRom.Api.Endpoints.Transfers.GetJob;
using TeensyRom.Api.Endpoints.Transfers.SealJob;
using TeensyRom.Api.Transfers;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Entities.Transfers;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Tests.Integration.Transfers
{
    /// <summary>
    /// What an upload leaves in the API's index, end to end over the fake device: the folder the upload creates is
    /// read back from the device under the job's lease, the job completes only after that read, and a folder the
    /// index already holds is not read again.
    /// </summary>
    [Collection("Transfer")]
    public class TransferIndexTests(TransferFixture f) : IAsyncLifetime
    {
        public Task InitializeAsync() => Task.CompletedTask;

        public Task DisposeAsync() => f.WaitForQuiescenceAsync();

        private async Task UploadAndCompleteAsync(string deviceId, string folder, string fileName)
        {
            var leaseCoordinator = f.Services.GetRequiredService<IDeviceLeaseCoordinator>();
            var created = await f.Client.PostAsync<CreateJobEndpoint, CreateJobRequest, CreateJobResponse>(new()
            {
                DeviceId = deviceId,
                StorageType = TeensyStorageType.SD,
                Body = new CreateJobBody { DestinationDirectory = folder }
            });
            var jobId = created.Content.JobId;

            var body = new ByteArrayContent([1, 2, 3]);
            body.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            var upload = await f.RawClient.PostAsync($"/api/transfers/{jobId}/files?path={fileName}", body);
            upload.StatusCode.Should().Be(HttpStatusCode.OK);

            await f.Client.PostAsync<SealJobEndpoint, SealJobRequest, SealJobResponse>(new() { JobId = jobId });

            var deadline = DateTime.UtcNow.AddSeconds(15);

            while (DateTime.UtcNow < deadline)
            {
                var job = (await f.Client.GetAsync<GetJobEndpoint, GetJobRequest, GetJobResponse>(new() { JobId = jobId })).Content.Job;

                if (job.State == TransferJobState.Completed && leaseCoordinator.GetHolder(deviceId) is null) return;

                await Task.Delay(20);
            }

            throw new TimeoutException($"Job {jobId} did not complete.");
        }

        [Fact]
        public async Task Upload_IntoAFolderTheIndexNeverHeld_ReadsItFromTheDeviceAndListsItUnderItsParent()
        {
            var device = f.DeviceManager.Devices[0];
            var port = f.DeviceManager.PortFor(device.DeviceId);
            var folder = $"/index-tests/{Guid.NewGuid():N}/";

            await UploadAndCompleteAsync(device.DeviceId, folder, "a.prg");

            port.DirectoryReads.Should().Contain(folder);
            var storage = device.GetStorage(TeensyStorageType.SD)!;
            (await storage.GetDirectory(new DirectoryPath(folder)))!.Files.Select(file => file.Name).Should().Equal("a.prg");
            (await storage.GetDirectory(new DirectoryPath("/index-tests/")))!.Directories
                .Should().Contain(directory => directory.Path.Equals(new DirectoryPath(folder)));
        }

        [Fact]
        public async Task Upload_IntoAFolderTheIndexAlreadyHolds_SendsNoRead()
        {
            var device = f.DeviceManager.Devices[0];
            var port = f.DeviceManager.PortFor(device.DeviceId);
            var folder = $"/index-tests/{Guid.NewGuid():N}/";
            await UploadAndCompleteAsync(device.DeviceId, folder, "a.prg");
            var readsBefore = port.DirectoryReads.Count;

            await UploadAndCompleteAsync(device.DeviceId, folder, "b.prg");

            port.DirectoryReads.Count.Should().Be(readsBefore);
            (await device.GetStorage(TeensyStorageType.SD)!.GetDirectory(new DirectoryPath(folder)))!.Files
                .Select(file => file.Name).Should().Equal("a.prg", "b.prg");
        }
    }
}
