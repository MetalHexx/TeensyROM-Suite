using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Commands;
using TeensyRom.Core.Commands.GetFile;
using TeensyRom.Core.Entities.Device;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Serial.Commands;
using TeensyRom.Core.Serial.Commands.Behaviors;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Core.Serial.Tests.Unit.Commands.Behaviors;

public class TransferLockoutBehaviorTests
{
    private const string DeviceId = "device-1";
    private const string HolderJobId = "job-1";

    private sealed class FakeCommand : ITeensyCommand<TeensyCommandResult>
    {
        public string? DeviceId { get; set; }
        public required ICommunicationPort CommunicationPort { get; init; }
    }

    private readonly IDeviceTransferLease _lease = Substitute.For<IDeviceTransferLease>();
    private readonly IDeviceConnectionManager _devices = Substitute.For<IDeviceConnectionManager>();
    private readonly ILoggingService _log = Substitute.For<ILoggingService>();
    private readonly ICommunicationPort _port = Substitute.For<ICommunicationPort>();
    private int _nextInvocations;

    public TransferLockoutBehaviorTests()
    {
        // NSubstitute answers an unconfigured string member with "", which would read as a holder.
        _lease.GetActiveJobId(Arg.Any<string>()).Returns((string?)null);
    }

    private Task<TResponse> Send<TRequest, TResponse>(TRequest request)
        where TRequest : ITeensyCommand<TResponse>
        where TResponse : TeensyCommandResult, new() =>
        new TransferLockoutBehavior<TRequest, TResponse>(_lease, _devices, _log)
            .Handle(request, () =>
            {
                _nextInvocations++;
                return Task.FromResult(new TResponse());
            }, CancellationToken.None);

    private Task<TeensyCommandResult> SendFake(string? deviceId) =>
        Send<FakeCommand, TeensyCommandResult>(new FakeCommand { DeviceId = deviceId, CommunicationPort = _port });

    private Task<ResetResult> SendReset(string? transferJobId) =>
        Send<ResetCommand, ResetResult>(new ResetCommand { DeviceId = DeviceId, CommunicationPort = _port, TransferJobId = transferJobId });

    private void LeaseDevice(string deviceId = DeviceId, string jobId = HolderJobId) =>
        _lease.GetActiveJobId(deviceId).Returns(jobId);

    private void KnowDeviceAs(string name)
    {
        var cart = new Cart { DeviceId = DeviceId, Name = name };
        var device = new TeensyRomDevice(cart, _port, Substitute.For<IStorageService>(), Substitute.For<IStorageService>(), new DeviceConnectionRecord(DeviceId));
        _devices.GetAvailableDevice(DeviceId).Returns(device);
    }

    [Fact]
    public async Task Handle_UnstampedCommandToLeasedDevice_IsRefusedWithoutCallingNext()
    {
        LeaseDevice();
        KnowDeviceAs("Kitchen");

        var response = await SendFake(DeviceId);

        response.IsSuccess.Should().BeFalse();
        response.ActiveTransferJobId.Should().Be(HolderJobId);
        response.Error.Should().Contain("Kitchen");
        response.IsBusy.Should().BeFalse();
        _nextInvocations.Should().Be(0);
    }

    [Fact]
    public async Task Handle_RefusalForUnknownDevice_NamesTheDeviceById()
    {
        LeaseDevice();

        var response = await SendFake(DeviceId);

        response.IsSuccess.Should().BeFalse();
        response.Error.Should().Contain(DeviceId);
    }

    [Fact]
    public async Task Handle_Refusal_LogsAWarningAgainstTheDevice()
    {
        LeaseDevice();

        await SendFake(DeviceId);

        _log.Received(1).InternalWarning(Arg.Is<string>(m => m.Contains(HolderJobId)), DeviceId);
    }

    [Fact]
    public async Task Handle_ResetStampedWithTheHolderJobId_PassesToNext()
    {
        LeaseDevice();

        var response = await SendReset(HolderJobId);

        response.IsSuccess.Should().BeTrue();
        response.ActiveTransferJobId.Should().BeNull();
        _nextInvocations.Should().Be(1);
    }

    [Fact]
    public async Task Handle_ResetWithNoJobId_IsRefused()
    {
        LeaseDevice();

        var response = await SendReset(null);

        response.IsSuccess.Should().BeFalse();
        response.ActiveTransferJobId.Should().Be(HolderJobId);
        _nextInvocations.Should().Be(0);
    }

    [Fact]
    public async Task Handle_ResetStampedWithAnotherJobId_IsRefused()
    {
        LeaseDevice();

        var response = await SendReset("job-2");

        response.IsSuccess.Should().BeFalse();
        response.ActiveTransferJobId.Should().Be(HolderJobId);
        _nextInvocations.Should().Be(0);
    }

    [Fact]
    public async Task Handle_TransferFilesStampedWithTheHolderJobId_PassesToNext()
    {
        LeaseDevice();
        var command = new TransferFilesCommand
        {
            DeviceId = DeviceId,
            CommunicationPort = _port,
            Files = [],
            OnFileCompleted = (_, _) => Task.CompletedTask,
            TransferJobId = HolderJobId
        };

        var response = await Send<TransferFilesCommand, TransferFilesResult>(command);

        response.IsSuccess.Should().BeTrue();
        _nextInvocations.Should().Be(1);
    }

    private Task<GetDirectoryRecursiveResult> SendDirectoryRead(string? transferJobId) =>
        Send<GetDirectoryRecursiveCommand, GetDirectoryRecursiveResult>(new GetDirectoryRecursiveCommand
        {
            StorageType = TeensyStorageType.SD,
            Path = new DirectoryPath("/music/"),
            Recursive = false,
            DeviceId = DeviceId,
            CommunicationPort = _port,
            TransferJobId = transferJobId
        });

    private Task<GetFileResult> SendFileRead(string? transferJobId) =>
        Send<GetFileCommand, GetFileResult>(new GetFileCommand
        {
            StorageType = TeensyStorageType.SD,
            FilePath = new FilePath("/music/playlist.json"),
            DeviceId = DeviceId,
            CommunicationPort = _port,
            TransferJobId = transferJobId
        });

    [Fact]
    public async Task Handle_DirectoryReadStampedWithTheHolderJobId_PassesToNext()
    {
        LeaseDevice();

        var response = await SendDirectoryRead(HolderJobId);

        response.IsSuccess.Should().BeTrue();
        _nextInvocations.Should().Be(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("job-2")]
    public async Task Handle_DirectoryReadNotStampedWithTheHolderJobId_IsRefused(string? transferJobId)
    {
        LeaseDevice();

        var response = await SendDirectoryRead(transferJobId);

        response.IsSuccess.Should().BeFalse();
        response.ActiveTransferJobId.Should().Be(HolderJobId);
        _nextInvocations.Should().Be(0);
    }

    [Fact]
    public async Task Handle_FileReadStampedWithTheHolderJobId_PassesToNext()
    {
        LeaseDevice();

        var response = await SendFileRead(HolderJobId);

        response.IsSuccess.Should().BeTrue();
        _nextInvocations.Should().Be(1);
    }

    [Fact]
    public async Task Handle_FileReadWithNoJobId_IsRefused()
    {
        LeaseDevice();

        var response = await SendFileRead(null);

        response.IsSuccess.Should().BeFalse();
        response.ActiveTransferJobId.Should().Be(HolderJobId);
        _nextInvocations.Should().Be(0);
    }

    [Fact]
    public async Task Handle_DeviceWithNoLease_PassesToNext()
    {
        var response = await SendFake(DeviceId);

        response.IsSuccess.Should().BeTrue();
        _nextInvocations.Should().Be(1);
    }

    [Fact]
    public async Task Handle_AnotherDeviceIsLeased_PassesToNext()
    {
        LeaseDevice(deviceId: "device-2");

        var response = await SendFake(DeviceId);

        response.IsSuccess.Should().BeTrue();
        _nextInvocations.Should().Be(1);
    }

    [Fact]
    public async Task Handle_NullDeviceId_PassesToNextWithoutAskingTheLease()
    {
        var response = await SendFake(null);

        response.IsSuccess.Should().BeTrue();
        _nextInvocations.Should().Be(1);
        _lease.DidNotReceiveWithAnyArgs().GetActiveJobId(default!);
    }
}
