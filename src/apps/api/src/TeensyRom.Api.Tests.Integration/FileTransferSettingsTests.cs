using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using TeensyRom.Api.Endpoints.Settings.GetFileTransferSettings;
using TeensyRom.Api.Endpoints.Settings.SetFileTransferSettings;
using TeensyRom.Core.Settings;

namespace TeensyRom.Api.Tests.Integration
{
    [Collection("Endpoint")]
    public class FileTransferSettingsTests(EndpointFixture f) : IDisposable
    {
        private readonly ISettingsService _settings = f.Services.GetRequiredService<ISettingsService>();
        private readonly FileTransferSettings _original = f.Services.GetRequiredService<ISettingsService>().GetSettings().FileTransferSettings with { };

        public void Dispose() => _settings.UpdateSettings(s => s with { FileTransferSettings = _original });

        private void GivenTransfer(bool autoLaunch, bool folders, bool archives) =>
            _settings.UpdateSettings(s => s with
            {
                FileTransferSettings = new FileTransferSettings
                {
                    AutoLaunchOnCopyEnabled = autoLaunch,
                    AllFileTypesInFolders = folders,
                    AllFileTypesInArchives = archives
                }
            });

        [Fact]
        public async Task Get_ReturnsAllThreeSettings()
        {
            GivenTransfer(autoLaunch: false, folders: true, archives: false);

            var r = await f.Client.GetAsync<GetFileTransferSettingsEndpoint, GetFileTransferSettingsResponse>();

            r.Should().BeSuccessful<GetFileTransferSettingsResponse>().WithStatusCode(HttpStatusCode.OK).WithContentNotNull();
            r.Content.FileTransferSettings.Should().BeEquivalentTo(
                new { AutoLaunchOnCopyEnabled = false, AllFileTypesInFolders = true, AllFileTypesInArchives = false });
        }

        [Fact]
        public async Task Set_OneField_ChangesOnlyThatFieldAndReturnsAllThree()
        {
            GivenTransfer(autoLaunch: true, folders: false, archives: true);

            var r = await f.Client.PutAsync<SetFileTransferSettingsEndpoint, SetFileTransferSettingsRequest, SetFileTransferSettingsResponse>(new()
            {
                Body = new SetFileTransferSettingsBody { AllFileTypesInFolders = true }
            });

            r.Should().BeSuccessful<SetFileTransferSettingsResponse>().WithStatusCode(HttpStatusCode.OK);
            r.Content.FileTransferSettings.Should().BeEquivalentTo(
                new { AutoLaunchOnCopyEnabled = true, AllFileTypesInFolders = true, AllFileTypesInArchives = true });
            _settings.GetSettings().FileTransferSettings.Should().BeEquivalentTo(
                new { AutoLaunchOnCopyEnabled = true, AllFileTypesInFolders = true, AllFileTypesInArchives = true });
        }

        [Fact]
        public async Task Set_FalseValue_IsAppliedNotTreatedAsAbsent()
        {
            GivenTransfer(autoLaunch: true, folders: true, archives: true);

            var r = await f.Client.PutAsync<SetFileTransferSettingsEndpoint, SetFileTransferSettingsRequest, SetFileTransferSettingsResponse>(new()
            {
                Body = new SetFileTransferSettingsBody { AutoLaunchOnCopyEnabled = false }
            });

            r.Content.FileTransferSettings.AutoLaunchOnCopyEnabled.Should().BeFalse();
            r.Content.FileTransferSettings.AllFileTypesInFolders.Should().BeTrue();
        }

        [Fact]
        public async Task Set_EmptyBody_Is400()
        {
            var r = await f.Client.PutAsync<SetFileTransferSettingsEndpoint, SetFileTransferSettingsRequest, ProblemDetails>(new()
            {
                Body = new SetFileTransferSettingsBody()
            });

            r.Should().BeProblem().WithStatusCode(HttpStatusCode.BadRequest);
        }
    }
}
