using MediatR;
using Microsoft.Extensions.DependencyInjection;
using TeensyRom.Api.Transfers;
using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Commands;
using TeensyRom.Core.Entities.Device;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Entities.Transfers;
using TeensyRom.Core.Logging;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Tests.Unit.Transfers;

/// <summary>
/// TryFinalize and Cancel are the two places a job reaches a terminal state under its own steam, shared
/// by the pump, the sweeper, and the cancel endpoint - exercised directly here rather than through the
/// queue-draining loop. <see cref="_scratch"/> is a real
/// <see cref="TransferScratchStore"/> rather than a substitute so the release tests can assert the
/// budget itself (<see cref="ITransferScratchStore.BytesInUse"/>) coming back, not just that a purge call
/// was made. The one test that does run the loop checks the commands it sends carry their job's id.
/// </summary>
public class TransferPumpTests : IDisposable
{
    private const long MaxScratchBytes = 1000;

    private readonly string _scratchRoot = Directory.CreateTempSubdirectory("teensyrom-pump-scratch-tests-").FullName;
    private readonly ITransferQueue _queue = Substitute.For<ITransferQueue>();
    private readonly ITransferJobRegistry _registry = Substitute.For<ITransferJobRegistry>();
    private readonly IDeviceLeaseCoordinator _leaseCoordinator = Substitute.For<IDeviceLeaseCoordinator>();
    private readonly ITransferCapacityGate _gate = Substitute.For<ITransferCapacityGate>();
    private readonly ITransferStagingStore _staging = Substitute.For<ITransferStagingStore>();
    private readonly ITransferAdmission _admission = Substitute.For<ITransferAdmission>();
    private readonly IDeviceConnectionManager _deviceManager = Substitute.For<IDeviceConnectionManager>();
    private readonly IServiceScopeFactory _scopeFactory = Substitute.For<IServiceScopeFactory>();
    private readonly ITransferProgressNotifier _notifier = Substitute.For<ITransferProgressNotifier>();
    private readonly ITransferAutoLauncher _autoLauncher = Substitute.For<ITransferAutoLauncher>();
    private readonly TransferOptions _options = new();
    private readonly ILoggingService _log = Substitute.For<ILoggingService>();
    private readonly ITransferScratchStore _scratch;

    public TransferPumpTests()
    {
        _scratch = new TransferScratchStore(
            new TransferOptions { ScratchRoot = _scratchRoot, MaxScratchBytes = MaxScratchBytes }, Substitute.For<ILoggingService>());
    }

    public void Dispose()
    {
        _provider?.Dispose();

        if (Directory.Exists(_scratchRoot))
        {
            Directory.Delete(_scratchRoot, recursive: true);
        }
    }

    private TransferPump NewPump() => new(
        _queue, _registry, _leaseCoordinator, _gate, _staging, _scratch, _admission, _deviceManager, _scopeFactory, _notifier, _autoLauncher, _options, _log);

    private static TransferJob NewJob() =>
        new("device-1", TeensyStorageType.SD, new DirectoryPath("/transfers"), new TransferOptions());

    private static TransferJob JobIn(TransferJobState state, int pendingCount)
    {
        var job = NewJob();

        switch (state)
        {
            case TransferJobState.Created:
                break;
            case TransferJobState.Receiving:
                job.TryTransitionTo(TransferJobState.Receiving);
                break;
            case TransferJobState.Sealed:
                job.TryTransitionTo(TransferJobState.Receiving);
                job.TryTransitionTo(TransferJobState.Sealed);
                break;
            case TransferJobState.Completed:
                job.TryTransitionTo(TransferJobState.Receiving);
                job.TryTransitionTo(TransferJobState.Sealed);
                job.TryTransitionTo(TransferJobState.Completed);
                break;
            case TransferJobState.Cancelled:
                job.TryTransitionTo(TransferJobState.Cancelled);
                break;
            case TransferJobState.Abandoned:
                job.TryTransitionTo(TransferJobState.Abandoned);
                break;
            case TransferJobState.Aborted:
                job.TryTransitionTo(TransferJobState.Aborted);
                break;
        }

        for (var i = 0; i < pendingCount; i++)
        {
            job.OnFileReceived(1);
        }

        return job;
    }

    public static IEnumerable<object[]> AllStatesAtZeroPending()
    {
        foreach (var state in Enum.GetValues<TransferJobState>())
        {
            var expectedNext = state switch
            {
                TransferJobState.Sealed => TransferJobState.Completed,
                _ => state
            };

            yield return [state, expectedNext];
        }
    }

    [Theory]
    [MemberData(nameof(AllStatesAtZeroPending))]
    public void TryFinalize_EveryStateWithNoPendingFiles_MatchesTruthTable(TransferJobState state, TransferJobState expectedState)
    {
        var job = JobIn(state, pendingCount: 0);
        var pump = NewPump();

        pump.TryFinalize(job);

        job.State.Should().Be(expectedState);
    }

    [Fact]
    public void TryFinalize_SealedWithPendingFiles_DoesNotTransition()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 1);
        var pump = NewPump();

        pump.TryFinalize(job);

        job.State.Should().Be(TransferJobState.Sealed);
        _leaseCoordinator.DidNotReceiveWithAnyArgs().Release(default!, default!);
    }

    [Fact]
    public void TryFinalize_SealedToCompleted_ReleasesLeasePurgesStagingAndNotifies()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 0);
        var pump = NewPump();

        pump.TryFinalize(job);

        _leaseCoordinator.Received(1).Release("device-1", job.JobId);
        _staging.Received(1).PurgeJob(job.JobId);
        _notifier.Received(1).JobChanged(job);
    }

    [Fact]
    public void TryFinalize_SealedToCompleted_StartsTheLaunchOnlyAfterTheLeaseIsReleased()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 0);
        var pump = NewPump();

        pump.TryFinalize(job);

        Received.InOrder(() =>
        {
            _leaseCoordinator.Release("device-1", job.JobId);
            _autoLauncher.StartLaunch(job);
        });
    }

    [Fact]
    public void TryFinalize_LaunchDue_CompletesTheJobWithTheLaunchPending()
    {
        var job = JobIn(TransferJobState.Receiving, pendingCount: 0);
        job.OnFileReceived(1);
        job.OnFileSent(new TransferFileCompleted(job.JobId, "a.prg", "/transfers/a.prg", true, null, 1));
        job.TryTransitionTo(TransferJobState.Sealed);
        _autoLauncher.ShouldLaunch(job).Returns(true);
        var pump = NewPump();

        pump.TryFinalize(job);

        var snapshot = job.ToSnapshot();
        snapshot.State.Should().Be(TransferJobState.Completed);
        snapshot.LaunchState.Should().Be(TransferLaunchState.Pending);
        snapshot.LaunchedPath.Should().Be("/transfers/a.prg");
    }

    /// <summary>
    /// Asserts the scratch budget itself, not just that a purge call happened - a job that reserved
    /// scratch space (as an archive upload would) must get every byte of it back on completion.
    /// </summary>
    [Fact]
    public void TryFinalize_SealedToCompleted_ReturnsScratchBudgetToPreJobValue()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 0);
        _scratch.TryReserve(job.JobId, 400).Should().BeTrue();
        var pump = NewPump();

        pump.TryFinalize(job);

        _scratch.BytesInUse.Should().Be(0);
        _admission.DidNotReceiveWithAnyArgs().DiscardHeld(default!);
    }

    /// <summary>
    /// The property the old drain could not offer: files still pending is exactly the state a cancel
    /// has to survive, so the transition and every release run regardless of the count.
    /// </summary>
    [Theory]
    [InlineData(TransferJobState.Created)]
    [InlineData(TransferJobState.Receiving)]
    [InlineData(TransferJobState.Sealed)]
    public void Cancel_JobWithPendingFiles_IsCancelledAndReleasesEverythingImmediately(TransferJobState state)
    {
        var job = JobIn(state, pendingCount: 3);
        var pump = NewPump();

        pump.Cancel(job).Should().BeTrue();

        job.State.Should().Be(TransferJobState.Cancelled);
        _leaseCoordinator.Received(1).Release("device-1", job.JobId);
        _staging.Received(1).PurgeJob(job.JobId);
        _notifier.Received(1).JobChanged(job);
    }

    /// <summary>
    /// Cancelling releases the scratch budget exactly like completion, and additionally discards
    /// anything still held for the job - a cancelled job will never drain a held file any other way.
    /// </summary>
    [Fact]
    public void Cancel_JobHoldingScratch_ReturnsScratchBudgetAndDiscardsHeld()
    {
        var job = JobIn(TransferJobState.Receiving, pendingCount: 1);
        _scratch.TryReserve(job.JobId, 250).Should().BeTrue();
        var pump = NewPump();

        pump.Cancel(job);

        _scratch.BytesInUse.Should().Be(0);
        _admission.Received(1).DiscardHeld(job.JobId);
    }

    [Theory]
    [InlineData(TransferJobState.Completed)]
    [InlineData(TransferJobState.Cancelled)]
    [InlineData(TransferJobState.Abandoned)]
    [InlineData(TransferJobState.Aborted)]
    public void Cancel_AlreadyTerminalJob_ChangesNothing(TransferJobState state)
    {
        var job = JobIn(state, pendingCount: 0);
        var pump = NewPump();

        pump.Cancel(job).Should().BeFalse();

        job.State.Should().Be(state);
        _leaseCoordinator.DidNotReceiveWithAnyArgs().Release(default!, default!);
        _staging.DidNotReceiveWithAnyArgs().PurgeJob(default!);
        _admission.DidNotReceiveWithAnyArgs().DiscardHeld(default!);
    }

    [Fact]
    public void Cancel_SignalsTheJobsCancellationTokenSoALiveExpansionCanStop()
    {
        var job = JobIn(TransferJobState.Receiving, pendingCount: 1);

        NewPump().Cancel(job);

        job.Cancellation.IsCancellationRequested.Should().BeTrue();
    }

    [Fact]
    public void TryFinalize_CalledTwiceAfterTransition_IsIdempotent()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 0);
        var pump = NewPump();

        pump.TryFinalize(job);
        pump.TryFinalize(job);

        job.State.Should().Be(TransferJobState.Completed);
        _leaseCoordinator.Received(1).Release("device-1", job.JobId);
        _staging.Received(1).PurgeJob(job.JobId);
    }

    [Fact]
    public async Task Drain_SendsTheResetAndTheFileBatchStampedWithTheJobId()
    {
        var job = JobIn(TransferJobState.Receiving, pendingCount: 1);
        var stagingPath = Path.Combine(_scratchRoot, "file.prg");
        await File.WriteAllBytesAsync(stagingPath, [1, 2, 3]);
        var staged = new StagedFile(job.JobId, stagingPath, "file.prg", new FilePath("/transfers/file.prg"), TeensyStorageType.SD, 3, 3);
        var device = new TeensyRomDevice(
            new Cart { DeviceId = job.DeviceId }, Substitute.For<ICommunicationPort>(),
            Substitute.For<IStorageService>(), Substitute.For<IStorageService>(), new DeviceConnectionRecord(job.DeviceId));
        var mediator = Substitute.For<IMediator>();
        mediator.Send(Arg.Any<ResetCommand>(), Arg.Any<CancellationToken>()).Returns(new ResetResult());
        mediator.Send(Arg.Any<TransferFilesCommand>(), Arg.Any<CancellationToken>()).Returns(new TransferFilesResult());
        using var provider = new ServiceCollection().AddSingleton(mediator).BuildServiceProvider();
        _scopeFactory.CreateScope().Returns(_ => provider.CreateScope());
        _queue.ActiveDeviceIds.Returns(new[] { job.DeviceId });
        _queue.ReadAllAsync(job.DeviceId, Arg.Any<CancellationToken>()).Returns(_ => Once(staged));
        _registry.Get(job.JobId).Returns(job);
        _deviceManager.GetAvailableDevice(job.DeviceId).Returns(device);
        var pump = NewPump();

        await pump.StartAsync(CancellationToken.None);

        try
        {
            await WaitUntil(() => mediator.ReceivedCalls().Any(c => c.GetArguments().OfType<TransferFilesCommand>().Any()));
        }
        finally
        {
            await pump.StopAsync(CancellationToken.None);
        }

        await mediator.Received(1).Send(Arg.Is<ResetCommand>(c => c.TransferJobId == job.JobId && c.DeviceId == job.DeviceId), Arg.Any<CancellationToken>());
        await mediator.Received(1).Send(Arg.Is<TransferFilesCommand>(c => c.TransferJobId == job.JobId && c.DeviceId == job.DeviceId), Arg.Any<CancellationToken>());
    }

    private static readonly DirectoryPath NewFolder = new("/transfers/");

    private ServiceProvider? _provider;

    private bool LeaseReleased() =>
        _leaseCoordinator.ReceivedCalls().Any(call => call.GetMethodInfo().Name == nameof(IDeviceLeaseCoordinator.Release));

    private static IStorageService StorageCreating(params DirectoryPath[] folders)
    {
        var storage = Substitute.For<IStorageService>();
        storage.UpsertTransferredFile(Arg.Any<FilePath>(), Arg.Any<long>()).Returns(folders);
        storage.RereadFolders(Arg.Any<IReadOnlyCollection<DirectoryPath>>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.CompletedTask);
        return storage;
    }

    /// <summary>
    /// Runs the drain loop over one staged file for <paramref name="job"/>, which the device "writes" and reports
    /// saved. <paramref name="afterFileSent"/> runs inside the transfer command, once the file's outcome has been
    /// handled and before the pump goes on to the folder read: the window another thread's seal or sweep can land in.
    /// </summary>
    private async Task RunOneSavedFileAsync(TransferJob job, TransferPump pump, IStorageService storage, Action<TransferPump, TransferJob>? afterFileSent, Func<bool> done)
    {
        var stagingPath = Path.Combine(_scratchRoot, $"{Guid.NewGuid():N}.prg");
        await File.WriteAllBytesAsync(stagingPath, [1, 2, 3]);
        var staged = new StagedFile(job.JobId, stagingPath, "file.prg", new FilePath("/transfers/file.prg"), TeensyStorageType.SD, 3, 3);
        var device = new TeensyRomDevice(
            new Cart { DeviceId = job.DeviceId, SdStorage = new CartStorage(TeensyStorageType.SD, available: true) },
            Substitute.For<ICommunicationPort>(), storage, storage, new DeviceConnectionRecord(job.DeviceId));
        var mediator = Substitute.For<IMediator>();
        mediator.Send(Arg.Any<ResetCommand>(), Arg.Any<CancellationToken>()).Returns(new ResetResult());
        mediator.Send(Arg.Any<TransferFilesCommand>(), Arg.Any<CancellationToken>()).Returns(async call =>
        {
            var command = call.Arg<TransferFilesCommand>();

            foreach (var file in command.Files)
            {
                await command.OnFileCompleted(new TransferFileOutcome(file, Saved: true, Error: null, Attempted: true), CancellationToken.None);
            }
            afterFileSent?.Invoke(pump, job);
            return new TransferFilesResult();
        });
        _provider = new ServiceCollection().AddSingleton(mediator).BuildServiceProvider();
        _scopeFactory.CreateScope().Returns(_ => _provider.CreateScope());
        _queue.ActiveDeviceIds.Returns(new[] { job.DeviceId });
        _queue.ReadAllAsync(job.DeviceId, Arg.Any<CancellationToken>()).Returns(_ => Once(staged));
        _registry.Get(job.JobId).Returns(job);
        _deviceManager.GetAvailableDevice(job.DeviceId).Returns(device);

        await pump.StartAsync(CancellationToken.None);

        try
        {
            await WaitUntil(done, "the pump should have finished the batch");
        }
        finally
        {
            await pump.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task Drain_LastFileCreatedAFolder_JobCompletesOnlyAfterTheFolderIsReread()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 1);
        var pump = NewPump();
        var storage = StorageCreating(NewFolder);
        var stateBeforeRead = new List<(TransferJobState State, bool LeaseReleased)>();

        // The seal's or the sweeper's TryFinalize, landing after the file is counted and before the read.
        void FinalizeFromAnotherCaller(TransferPump p, TransferJob j)
        {
            p.TryFinalize(j);
            stateBeforeRead.Add((j.State, LeaseReleased()));
        }
        storage.RereadFolders(Arg.Any<IReadOnlyCollection<DirectoryPath>>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                FinalizeFromAnotherCaller(pump, job);
                return Task.CompletedTask;
            });

        await RunOneSavedFileAsync(job, pump, storage, FinalizeFromAnotherCaller, () => job.State == TransferJobState.Completed);

        job.PendingCount.Should().Be(0);
        stateBeforeRead.Should().HaveCount(2).And.OnlyContain(seen => seen.State == TransferJobState.Sealed && !seen.LeaseReleased);
        await storage.Received(1).RereadFolders(
            Arg.Is<IReadOnlyCollection<DirectoryPath>>(folders => folders.Single().Equals(NewFolder)), job.JobId, Arg.Any<CancellationToken>());
        Received.InOrder(() =>
        {
            storage.RereadFolders(Arg.Any<IReadOnlyCollection<DirectoryPath>>(), job.JobId, Arg.Any<CancellationToken>());
            _leaseCoordinator.Release(job.DeviceId, job.JobId);
            _autoLauncher.StartLaunch(job);
        });
    }

    [Fact]
    public async Task Drain_FolderAlreadyInTheIndex_SendsNoReadAndStillCompletes()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 1);
        var storage = StorageCreating();

        await RunOneSavedFileAsync(job, NewPump(), storage, null, () => job.State == TransferJobState.Completed);

        await storage.DidNotReceiveWithAnyArgs().RereadFolders(default!, default!, default);
    }

    [Fact]
    public async Task Drain_ReadThatThrows_ReleasesTheHoldAndTheJobCompletes()
    {
        var job = JobIn(TransferJobState.Sealed, pendingCount: 1);
        var storage = StorageCreating(NewFolder);
        storage.RereadFolders(Arg.Any<IReadOnlyCollection<DirectoryPath>>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new InvalidOperationException("the read blew up")));

        await RunOneSavedFileAsync(job, NewPump(), storage, null, () => job.State == TransferJobState.Completed);

        job.HasFolderReadsOutstanding.Should().BeFalse();
        _log.Received().InternalWarning(Arg.Is<string>(message => message.Contains("the read blew up")), job.DeviceId);
        _leaseCoordinator.Received(1).Release(job.DeviceId, job.JobId);
    }

    [Fact]
    public async Task Drain_JobCancelledBeforeTheRead_SendsNoReadAndReleasesTheHold()
    {
        var job = JobIn(TransferJobState.Receiving, pendingCount: 1);
        var storage = StorageCreating(NewFolder);

        // The file is counted, taking the hold, before the pump reaches its read; the hold going again is the batch ending.
        await RunOneSavedFileAsync(job, NewPump(), storage, (p, j) => p.Cancel(j), () => job.PendingCount == 0 && !job.HasFolderReadsOutstanding);

        job.State.Should().Be(TransferJobState.Cancelled);
        await storage.DidNotReceiveWithAnyArgs().RereadFolders(default!, default!, default);
    }

    private static async IAsyncEnumerable<StagedFile> Once(StagedFile file)
    {
        await Task.Yield();
        yield return file;
    }

    private static async Task WaitUntil(Func<bool> condition, string because = "the pump should have sent the batch")
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);

        while (!condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        condition().Should().BeTrue(because);
    }
}
