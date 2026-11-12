using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using TeensyRom.Api.Endpoints.Settings.SetFileTransferSettings;
using TeensyRom.Api.Endpoints.Transfers.CreateJob;
using TeensyRom.Api.Endpoints.Transfers.GetJob;
using TeensyRom.Api.Endpoints.Transfers.SealJob;
using TeensyRom.Api.Tests.Integration.Fixtures.Archives;
using TeensyRom.Api.Transfers;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Entities.Transfers;
using TeensyRom.Core.Settings;

namespace TeensyRom.Api.Tests.Integration.Transfers
{
    /// <summary>
    /// Which entries of an uploaded archive reach the device, over HTTP: a job created with
    /// <c>allFileTypesInArchives</c> sends every type, a job created without it follows the Uploads switch in settings,
    /// and Mac residue is never sent either way.
    /// </summary>
    [Collection("Transfer")]
    public class ArchiveFileTypesTests(TransferFixture f) : IAsyncLifetime
    {
        private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(15);

        public Task InitializeAsync() => Task.CompletedTask;

        public Task DisposeAsync() => f.WaitForQuiescenceAsync();

        private ISettingsService Settings => f.Services.GetRequiredService<ISettingsService>();

        private static byte[] Bytes(string s) => System.Text.Encoding.UTF8.GetBytes(s);

        private static byte[] PackWithAGameAndABin() => HostileArchiveFactory.Build(
            ArchiveFormat.Zip,
            new EntrySpec("game.prg", Bytes("PRG")),
            new EntrySpec("data.bin", Bytes("BIN")),
            new EntrySpec("__MACOSX/._game.prg", Bytes("RESIDUE")));

        /// <summary>Uploads the pack as one archive under <paramref name="destination"/>, waits for the job to finish, and returns what the device received.</summary>
        private async Task<List<string>> SendPackAsync(string destination, bool? allFileTypesInArchives)
        {
            var device = f.DeviceManager.Devices[0];
            var port = f.DeviceManager.PortFor(device.DeviceId);
            var priorCount = port.Received.Count;

            var create = await f.Client.PostAsync<CreateJobEndpoint, CreateJobRequest, CreateJobResponse>(new()
            {
                DeviceId = device.DeviceId,
                StorageType = TeensyStorageType.SD,
                Body = new CreateJobBody
                {
                    DestinationDirectory = destination,
                    ExpectedArchiveCount = 1,
                    AllFileTypesInArchives = allFileTypesInArchives
                }
            });
            var jobId = create.Content.JobId;

            var body = new ByteArrayContent(PackWithAGameAndABin()) { Headers = { ContentType = new MediaTypeHeaderValue("application/octet-stream") } };
            var upload = await f.RawClient.PostAsync($"/api/transfers/{jobId}/files?path=pack.zip", body);
            upload.StatusCode.Should().Be(HttpStatusCode.OK);

            await f.Client.PostAsync<SealJobEndpoint, SealJobRequest, SealJobResponse>(new() { JobId = jobId });

            // Driven directly so completion does not wait on the sweeper's own timer.
            var sweeper = f.Services.GetServices<IHostedService>().OfType<TransferJobSweeper>().Single();
            var deadline = DateTime.UtcNow + PollTimeout;
            while (true)
            {
                sweeper.Sweep();
                var job = (await f.Client.GetAsync<GetJobEndpoint, GetJobRequest, GetJobResponse>(new() { JobId = jobId })).Content.Job;
                if (job.State == TransferJobState.Completed) break;
                if (DateTime.UtcNow > deadline) throw new TimeoutException($"Job {jobId} did not complete; it was {job.State}.");
                await Task.Delay(20);
            }

            return port.Received.Skip(priorCount).Select(r => r.Path).Where(p => p.StartsWith(destination + "/", StringComparison.Ordinal))
                .Order(StringComparer.Ordinal).ToList();
        }

        [Fact]
        public async Task CreateJob_WithAllFileTypesInArchives_SendsTheBinAndNeverTheMacResidue()
        {
            var sent = await SendPackAsync("/music/archive-types-explicit", allFileTypesInArchives: true);

            sent.Should().Equal("/music/archive-types-explicit/pack/data.bin", "/music/archive-types-explicit/pack/game.prg");
        }

        [Fact]
        public async Task CreateJob_WithTheFieldAbsent_SendsTheBinOnlyOnceTheUploadsSwitchIsOn()
        {
            var original = Settings.GetSettings().FileTransferSettings with { };

            try
            {
                var switchOff = await f.Client.PutAsync<SetFileTransferSettingsEndpoint, SetFileTransferSettingsRequest, SetFileTransferSettingsResponse>(new()
                {
                    Body = new SetFileTransferSettingsBody { AllFileTypesInArchives = false }
                });
                switchOff.Content.FileTransferSettings.AllFileTypesInArchives.Should().BeFalse();

                (await SendPackAsync("/music/archive-types-off", allFileTypesInArchives: null))
                    .Should().Equal("/music/archive-types-off/pack/game.prg");

                var switchOn = await f.Client.PutAsync<SetFileTransferSettingsEndpoint, SetFileTransferSettingsRequest, SetFileTransferSettingsResponse>(new()
                {
                    Body = new SetFileTransferSettingsBody { AllFileTypesInArchives = true }
                });
                switchOn.Content.FileTransferSettings.AllFileTypesInArchives.Should().BeTrue();

                (await SendPackAsync("/music/archive-types-on", allFileTypesInArchives: null))
                    .Should().Equal("/music/archive-types-on/pack/data.bin", "/music/archive-types-on/pack/game.prg");
            }
            finally
            {
                Settings.UpdateSettings(s => s with { FileTransferSettings = original });
            }
        }
    }
}
