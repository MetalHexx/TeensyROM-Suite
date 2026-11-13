using MediatR;
using TeensyRom.Api.Tests.Unit.Endpoints;
using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Commands;
using TeensyRom.Core.Commands.DeleteFile;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Games;
using TeensyRom.Core.Logging;
using TeensyRom.Core.Music;
using TeensyRom.Core.Serial.Commands.Common;
using TeensyRom.Core.Settings;
using TeensyRom.Core.Storage;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Tests.Unit.Storage;

public class StorageDeleteFileTests
{
    private readonly IStorageCache _cache = Substitute.For<IStorageCache>();
    private readonly IMediator _mediator = Substitute.For<IMediator>();
    private readonly FilePath _tune = new("/music/tune.sid");
    private SearchSettings _bans = new();

    private StorageService NewService() => new(
        _cache,
        new StorageSettings
        {
            CartStorage = new CartStorage(TeensyStorageType.SD, available: true) { DeviceId = "device-1" },
            BanSource = () => _bans
        },
        _mediator,
        Substitute.For<ILoggingService>(),
        Substitute.For<ISidMetadataService>(),
        Substitute.For<IGameMetadataService>(),
        Substitute.For<ICommunicationPort>(),
        LeaseDoubles.Free());

    private void GivenCachedMusicFolder(params string[] subfolders) =>
        _cache.GetByDirPath(Arg.Any<DirectoryPath>()).Returns(new StorageCacheItem("/music")
        {
            Directories = [.. subfolders.Select(d => new DirectoryItem(d))],
            Files = [new LaunchableItem { Name = "tune.sid", Path = _tune, Size = 10 }]
        });

    private void GivenDeviceAnswers(DeleteFileResult result) =>
        _mediator.Send(Arg.Any<DeleteFileCommand>(), Arg.Any<CancellationToken>()).Returns(result);

    [Fact]
    public async Task DeleteFile_FileOnDevice_SendsTheDeleteDropsItFromTheCacheAndWritesToDisk()
    {
        GivenCachedMusicFolder();
        GivenDeviceAnswers(new DeleteFileResult());

        var result = await NewService().DeleteFile(_tune, CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.Deleted);
        await _mediator.Received(1).Send(
            Arg.Is<DeleteFileCommand>(c => c.Path.Value == "/music/tune.sid" && c.StorageType == TeensyStorageType.SD && c.DeviceId == "device-1"),
            Arg.Any<CancellationToken>());
        _cache.Received(1).DeleteFile(Arg.Is<FilePath>(p => p.Value == "/music/tune.sid"));
        _cache.Received(1).WriteToDisk();
    }

    [Theory]
    [InlineData("/music/Docs")]
    [InlineData("/MUSIC/docs")]
    public async Task DeleteFile_PathIsAFolderInTheParentListing_IsRefusedAndNothingIsSent(string path)
    {
        GivenCachedMusicFolder("/music/Docs");

        var result = await NewService().DeleteFile(new FilePath(path), CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.IsDirectory);
        await _mediator.DidNotReceive().Send(Arg.Any<DeleteFileCommand>(), Arg.Any<CancellationToken>());
        _cache.DidNotReceive().DeleteFile(Arg.Any<FilePath>());
    }

    [Fact]
    public async Task DeleteFile_FolderIsBanned_IsStillRefusedAsAFolder()
    {
        GivenCachedMusicFolder("/music/Docs");
        _bans = new SearchSettings { BannedDirectories = ["Docs"] };

        var result = await NewService().DeleteFile(new FilePath("/music/Docs"), CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.IsDirectory);
        await _mediator.DidNotReceive().Send(Arg.Any<DeleteFileCommand>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteFile_FileNotInTheStaleCache_IsStillSentToTheDevice()
    {
        GivenCachedMusicFolder();
        GivenDeviceAnswers(new DeleteFileResult());

        var result = await NewService().DeleteFile(new FilePath("/music/new.sid"), CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.Deleted);
        await _mediator.Received(1).Send(Arg.Any<DeleteFileCommand>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteFile_DeviceReportsFileNotFound_ReturnsNotFoundAndDropsItFromTheCache()
    {
        GivenCachedMusicFolder();
        GivenDeviceAnswers(new DeleteFileResult { IsSuccess = false, Error = "FILE NOT FOUND: /music/tune.sid" });

        var result = await NewService().DeleteFile(_tune, CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.NotFound);
        _cache.Received(1).DeleteFile(Arg.Is<FilePath>(p => p.Value == "/music/tune.sid"));
        _cache.Received(1).WriteToDisk();
    }

    [Theory]
    [InlineData("The SD card is write protected.", "The SD card is write protected.")]
    [InlineData("\0", "The TeensyROM could not delete the file.")]
    public async Task DeleteFile_DeviceReportsAnotherFailure_ReturnsFailedAndKeepsTheCache(string error, string expected)
    {
        GivenCachedMusicFolder();
        GivenDeviceAnswers(new DeleteFileResult { IsSuccess = false, Error = error });

        var result = await NewService().DeleteFile(_tune, CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.Failed);
        result.Failure.Should().Be(expected);
        _cache.DidNotReceive().DeleteFile(Arg.Any<FilePath>());
    }

    [Fact]
    public async Task DeleteFile_ParentReadFails_ReturnsFailedAndSendsNothing()
    {
        _cache.GetByDirPath(Arg.Any<DirectoryPath>()).Returns((IStorageCacheItem?)null);
        _mediator.Send(Arg.Any<GetDirectoryRecursiveCommand>(), Arg.Any<CancellationToken>())
            .Returns(new GetDirectoryRecursiveResult { IsSuccess = false, Error = "The link dropped." });

        var result = await NewService().DeleteFile(_tune, CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.Failed);
        result.Failure.Should().Be("The link dropped.");
        await _mediator.DidNotReceive().Send(Arg.Any<DeleteFileCommand>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteFile_ParentFolderMissing_ReturnsNotFoundAndSendsNothing()
    {
        _cache.GetByDirPath(Arg.Any<DirectoryPath>()).Returns((IStorageCacheItem?)null);
        _mediator.Send(Arg.Any<GetDirectoryRecursiveCommand>(), Arg.Any<CancellationToken>())
            .Returns(new GetDirectoryRecursiveResult { IsSuccess = false, ErrorCode = GetDirectoryErrorCode.DirectoryNotFoundError });

        var result = await NewService().DeleteFile(_tune, CancellationToken.None);

        result.Outcome.Should().Be(FileDeleteOutcome.NotFound);
        await _mediator.DidNotReceive().Send(Arg.Any<DeleteFileCommand>(), Arg.Any<CancellationToken>());
    }
}
