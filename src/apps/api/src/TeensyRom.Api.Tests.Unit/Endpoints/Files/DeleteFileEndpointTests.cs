using Microsoft.AspNetCore.Http.HttpResults;
using RadEndpoints.Testing;
using System.Net;
using TeensyRom.Api.Endpoints.Files.DeleteFile;
using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Entities.Device;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Tests.Unit.Endpoints.Files;

public class DeleteFileEndpointTests
{
    private const string DeviceId = "ABCD2345";
    private readonly IDeviceConnectionManager _deviceManager = Substitute.For<IDeviceConnectionManager>();
    private readonly IStorageService _sdStorage = Substitute.For<IStorageService>();
    private readonly IStorageService _usbStorage = Substitute.For<IStorageService>();

    private DeleteFileEndpoint GivenDevice(IDeviceTransferLease? lease = null, bool sdAvailable = true, bool usbAvailable = false)
    {
        var cart = new Cart
        {
            DeviceId = DeviceId,
            SdStorage = new CartStorage(TeensyStorageType.SD, sdAvailable),
            UsbStorage = new CartStorage(TeensyStorageType.USB, usbAvailable)
        };
        var device = new TeensyRomDevice(cart, Substitute.For<ICommunicationPort>(), _sdStorage, _usbStorage);
        _deviceManager.GetAvailableDevice(DeviceId).Returns(device);
        return EndpointFactory.CreateEndpoint<DeleteFileEndpoint>(_deviceManager, lease ?? LeaseDoubles.Free());
    }

    private void GivenOutcome(FileDeleteResult result, IStorageService? storage = null) =>
        (storage ?? _sdStorage).DeleteFile(Arg.Any<FilePath>(), Arg.Any<CancellationToken>()).Returns(result);

    private static DeleteFileRequest Request(TeensyStorageType storageType = TeensyStorageType.SD) =>
        new() { DeviceId = DeviceId, StorageType = storageType, FilePath = "/music/tune.sid" };

    [Fact]
    public async Task Handle_Deleted_SendsOk()
    {
        var endpoint = GivenDevice();
        GivenOutcome(FileDeleteResult.Deleted());

        await endpoint.Handle(Request(), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.OK);
        endpoint.Response.Should().BeEquivalentTo(new DeleteFileResponse { Message = "Deleted /music/tune.sid." });
    }

    [Fact]
    public async Task Handle_UsbStorage_DeletesOnTheUsbStorageOnly()
    {
        var endpoint = GivenDevice(usbAvailable: true);
        GivenOutcome(FileDeleteResult.Deleted(), _usbStorage);

        await endpoint.Handle(Request(TeensyStorageType.USB), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.OK);
        await _usbStorage.Received(1).DeleteFile(Arg.Is<FilePath>(p => p.Value == "/music/tune.sid"), Arg.Any<CancellationToken>());
        await _sdStorage.DidNotReceive().DeleteFile(Arg.Any<FilePath>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_UnknownDevice_SendsNotFound()
    {
        _deviceManager.GetAvailableDevice(DeviceId).Returns((TeensyRomDevice?)null);
        var endpoint = EndpointFactory.CreateEndpoint<DeleteFileEndpoint>(_deviceManager, LeaseDoubles.Free());

        await endpoint.Handle(Request(), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.NotFound);
        await _sdStorage.DidNotReceive().DeleteFile(Arg.Any<FilePath>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(TeensyStorageType.SD)]
    [InlineData(TeensyStorageType.USB)]
    public async Task Handle_UnavailableStorage_SendsNotFoundAndDeletesNothing(TeensyStorageType storageType)
    {
        var endpoint = GivenDevice(sdAvailable: false, usbAvailable: false);

        await endpoint.Handle(Request(storageType), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.NotFound);
        await _sdStorage.DidNotReceive().DeleteFile(Arg.Any<FilePath>(), Arg.Any<CancellationToken>());
        await _usbStorage.DidNotReceive().DeleteFile(Arg.Any<FilePath>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_NotFound_SendsNotFound()
    {
        var endpoint = GivenDevice();
        GivenOutcome(FileDeleteResult.NotFound());

        await endpoint.Handle(Request(), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Handle_IsDirectory_SendsBadRequest()
    {
        var endpoint = GivenDevice();
        GivenOutcome(FileDeleteResult.IsDirectory());

        await endpoint.Handle(Request(), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Handle_FailedWhileDeviceFree_SendsBadGatewayWithTheDeviceMessage()
    {
        var endpoint = GivenDevice();
        GivenOutcome(FileDeleteResult.Failed("The SD card is write protected."));

        await endpoint.Handle(Request(), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.BadGateway);
        endpoint.GetResult<ProblemHttpResult>().ProblemDetails.Title.Should().Be("The SD card is write protected.");
    }

    [Fact]
    public async Task Handle_FailedWhileDeviceBusy_SendsTheSharedConflict()
    {
        var endpoint = GivenDevice(LeaseDoubles.Busy());
        GivenOutcome(FileDeleteResult.Failed("busy"));

        await endpoint.Handle(Request(), CancellationToken.None);

        endpoint.GetStatusCode().Should().Be(HttpStatusCode.Conflict);
        endpoint.GetProblem<ProblemHttpResult>().ShouldBeDeviceBusy(DeviceId);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/music/")]
    [InlineData("/favorites/tune.sid")]
    [InlineData("/FAVORITES/music/tune.sid")]
    public void Validator_RefusesRootTrailingSlashAndFavoriteCopies(string path)
    {
        var request = Request();
        request.FilePath = path;

        new DeleteFileRequestValidator().Validate(request).IsValid.Should().BeFalse();
    }

    [Fact]
    public void Validator_AcceptsAnOrdinaryFilePath() =>
        new DeleteFileRequestValidator().Validate(Request()).IsValid.Should().BeTrue();
}
