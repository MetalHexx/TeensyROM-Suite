using System.Text;
using MediatR;
using TeensyRom.Api.Tests.Unit.Endpoints;
using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Commands;
using TeensyRom.Core.Commands.GetFile;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Games;
using TeensyRom.Core.Logging;
using TeensyRom.Core.Music;
using TeensyRom.Core.Serial.Commands;
using TeensyRom.Core.Storage;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Tests.Unit.Storage;

/// <summary>
/// The index has to match the cart after an upload and after any folder read: an upload into a folder the index
/// never held, a cache-miss read, and a partial re-index each add folders that the parent's listing must show.
/// These run the real cache under the real storage service, with only the cart's replies stubbed.
/// </summary>
public sealed class StorageIndexConsistencyTests : IDisposable
{
    private const string JobId = "job-1";

    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"tr-index-consistency-{Guid.NewGuid():N}");
    private readonly TempFileCache _cache;
    private readonly IMediator _mediator = Substitute.For<IMediator>();
    private readonly ILoggingService _log = Substitute.For<ILoggingService>();

    private sealed class TempFileCache(string cacheFilePath) : BaseStorageCache
    {
        protected override string CacheFilePath => cacheFilePath;
        protected override BanLists Bans => new([], []);
    }

    public StorageIndexConsistencyTests()
    {
        _cache = new TempFileCache(Path.Combine(_directory, "cache.json"));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    private StorageService NewService()
    {
        var sidMetadata = Substitute.For<ISidMetadataService>();
        sidMetadata.EnrichSong(Arg.Any<SongItem>()).Returns(call => call.Arg<SongItem>());
        var gameMetadata = Substitute.For<IGameMetadataService>();
        gameMetadata.EnrichGame(Arg.Any<GameItem>()).Returns(call => call.Arg<GameItem>());

        return new(
            _cache,
            new StorageSettings { CartStorage = new CartStorage(TeensyStorageType.SD, available: true) { DeviceId = "device-1" } },
            _mediator,
            _log,
            sidMetadata,
            gameMetadata,
            Substitute.For<ICommunicationPort>(),
            LeaseDoubles.Free());
    }

    private void Hold(string directory, params string[] subfolders)
    {
        var path = new DirectoryPath(directory);

        _cache.UpsertDirectory(path, new StorageCacheItem
        {
            Path = path,
            Directories = [.. subfolders.Select(s => new DirectoryItem(path.Combine(new DirectoryPath(s)).Value))]
        });
    }

    private static FileItem File(string path) => new() { Name = new FilePath(path).FileName, Path = new FilePath(path) };

    private static GetDirectoryRecursiveResult Listing(string directory, params string[] files) => new()
    {
        DirectoryContent = [new DirectoryContent { Path = new DirectoryPath(directory), Files = [.. files.Select(File)] }]
    };

    private void GivenDirectoryReply(GetDirectoryRecursiveResult result) =>
        _mediator.Send(Arg.Any<GetDirectoryRecursiveCommand>(), Arg.Any<CancellationToken>()).Returns(result);

    private IEnumerable<object> CommandsSent() =>
        _mediator.ReceivedCalls().Where(call => call.GetMethodInfo().Name == nameof(IMediator.Send)).Select(call => call.GetArguments()[0]!);

    private IEnumerable<string> SubfolderPaths(string directory) =>
        _cache.GetByDirPath(new DirectoryPath(directory))!.Directories.Select(d => d.Path.Value);

    private IEnumerable<string> FileNames(string directory) =>
        _cache.GetByDirPath(new DirectoryPath(directory))!.Files.Select(f => f.Name);

    [Fact]
    public void EnsureParents_MissingFolders_AreCreatedLinkedAndReturnedOutermostFirst()
    {
        Hold("/a/");

        var created = _cache.EnsureParents(new DirectoryPath("/a/b/c/"));

        created.Select(d => d.Value).Should().Equal("/a/b/", "/a/b/c/");
        SubfolderPaths("/a/").Should().Equal("/a/b/");
        SubfolderPaths("/a/b/").Should().Equal("/a/b/c/");
    }

    [Fact]
    public void EnsureParents_EmptyIndex_CreatesTheRootAndListsTheTopFolderThere()
    {
        var created = _cache.EnsureParents(new DirectoryPath("/a/"));

        created.Select(d => d.Value).Should().Equal("/", "/a/");
        SubfolderPaths("/").Should().Equal("/a/");
    }

    [Fact]
    public void EnsureParents_FolderAlreadyHeld_CreatesAndReturnsNothing()
    {
        Hold("/a/", "b");
        Hold("/a/b/");

        _cache.EnsureParents(new DirectoryPath("/a/b/")).Should().BeEmpty();
    }

    [Fact]
    public void UpsertFile_AtTheRootWithNoRootEntry_CreatesTheRootEntry()
    {
        var act = () => _cache.UpsertFile(File("/readme.txt"));

        act.Should().NotThrow();
        FileNames("/").Should().Equal("readme.txt");
    }

    [Fact]
    public void LinkToParent_HeldParent_ListsTheFolderOnceAndCreatesNoEntry()
    {
        Hold("/a/");

        _cache.LinkToParent(new DirectoryPath("/a/b/"));
        _cache.LinkToParent(new DirectoryPath("/a/b/"));

        SubfolderPaths("/a/").Should().Equal("/a/b/");
        _cache.GetByDirPath(new DirectoryPath("/a/b/")).Should().BeNull();
    }

    [Fact]
    public void LinkToParent_ParentNotHeldOrRoot_CreatesNothing()
    {
        _cache.LinkToParent(new DirectoryPath("/a/b/"));
        _cache.LinkToParent(new DirectoryPath("/"));

        _cache.Should().BeEmpty();
    }

    [Fact]
    public async Task RereadFolders_AfterAnUploadIntoAFolderTheIndexNeverHeld_ListsEverythingOnTheCart()
    {
        Hold("/a/");
        var service = NewService();
        var created = service.UpsertTransferredFile(new FilePath("/a/b/x.prg"), 10);
        GivenDirectoryReply(Listing("/a/b/", "/a/b/x.prg", "/a/b/old.prg"));

        await service.RereadFolders(created, JobId, CancellationToken.None);

        created.Select(d => d.Value).Should().Equal("/a/b/");
        FileNames("/a/b/").Should().BeEquivalentTo("x.prg", "old.prg");
        SubfolderPaths("/a/").Should().Equal("/a/b/");
    }

    [Fact]
    public async Task RereadFolders_SendsANonRecursiveReadStampedWithTheJobId()
    {
        GivenDirectoryReply(Listing("/a/b/", "/a/b/x.prg"));

        await NewService().RereadFolders([new DirectoryPath("/a/b/")], JobId, CancellationToken.None);

        var read = CommandsSent().Should().ContainSingle().Which.Should().BeOfType<GetDirectoryRecursiveCommand>().Subject;
        read.Recursive.Should().BeFalse();
        read.Path.Value.Should().Be("/a/b/");
        read.TransferJobId.Should().Be(JobId);
        read.DeviceId.Should().Be("device-1");
        _cache.GetByDirPath(new DirectoryPath("/a/b/")).Should().NotBeNull();
        _cache.GetByDirPath(new DirectoryPath("/a/")).Should().BeNull("a re-read never creates the parent's entry");
    }

    [Fact]
    public async Task RereadFolders_FolderWithAPlaylist_SendsOnlyStampedCommands()
    {
        GivenDirectoryReply(Listing("/a/b/", "/a/b/x.prg", "/a/b/playlist.json"));
        _mediator.Send(Arg.Any<GetFileCommand>(), Arg.Any<CancellationToken>())
            .Returns(new GetFileResult { FileData = Encoding.UTF8.GetBytes("{}") });

        await NewService().RereadFolders([new DirectoryPath("/a/b/")], JobId, CancellationToken.None);

        var sent = CommandsSent().ToList();
        sent.OfType<GetFileCommand>().Should().ContainSingle();
        sent.Should().HaveCount(2).And.AllSatisfy(command =>
            command.Should().BeAssignableTo<ITransferCommand>().Which.TransferJobId.Should().Be(JobId));
    }

    [Fact]
    public async Task RereadFolders_FailedRead_KeepsThePartialEntryLogsAWarningAndDoesNotThrow()
    {
        var service = NewService();
        var created = service.UpsertTransferredFile(new FilePath("/a/b/x.prg"), 10);
        GivenDirectoryReply(new GetDirectoryRecursiveResult { IsSuccess = false, Error = "device busy" });

        var act = () => service.RereadFolders(created, JobId, CancellationToken.None);

        await act.Should().NotThrowAsync();
        FileNames("/a/b/").Should().Equal("x.prg");
        _log.Received().InternalWarning(Arg.Any<string>(), "device-1");
    }

    [Fact]
    public async Task RereadFolders_ReadThatThrows_KeepsThePartialEntryAndReadsTheNextFolder()
    {
        Hold("/a/");
        var service = NewService();
        var created = service.UpsertTransferredFile(new FilePath("/a/b/x.prg"), 10)
            .Concat(service.UpsertTransferredFile(new FilePath("/a/c/y.prg"), 10))
            .ToList();
        _mediator.Send(Arg.Any<GetDirectoryRecursiveCommand>(), Arg.Any<CancellationToken>())
            .Returns<GetDirectoryRecursiveResult>(
                _ => throw new IOException("link dropped"),
                _ => Listing("/a/c/", "/a/c/y.prg", "/a/c/old.prg"));

        await service.RereadFolders(created, JobId, CancellationToken.None);

        created.Select(d => d.Value).Should().Equal("/a/b/", "/a/c/");
        FileNames("/a/b/").Should().Equal("x.prg");
        FileNames("/a/c/").Should().BeEquivalentTo("y.prg", "old.prg");
        _log.Received(1).InternalWarning(Arg.Is<string>(m => m.Contains("link dropped")), "device-1");
    }

    [Fact]
    public async Task RereadFolders_Cancelled_ThrowsWithoutSendingARead()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        var act = () => NewService().RereadFolders([new DirectoryPath("/a/b/")], JobId, cancelled.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
        CommandsSent().Should().BeEmpty();
    }

    [Fact]
    public async Task RereadFolders_NeverWritesTheIndexToDisk()
    {
        GivenDirectoryReply(Listing("/a/b/", "/a/b/x.prg"));

        await NewService().RereadFolders([new DirectoryPath("/a/b/")], JobId, CancellationToken.None);

        System.IO.File.Exists(Path.Combine(_directory, "cache.json")).Should().BeFalse();
    }

    [Fact]
    public void UpsertTransferredFile_FolderAlreadyHeld_CreatesNothingForTheCallerToRead()
    {
        Hold("/a/", "b");
        Hold("/a/b/");

        NewService().UpsertTransferredFile(new FilePath("/a/b/x.prg"), 10).Should().BeEmpty();
    }

    [Fact]
    public void UpsertTransferredFile_FolderHeldButMissingFromItsParentsList_LinksItAndItsAncestors()
    {
        Hold("/");
        Hold("/a/");
        Hold("/a/b/");

        var created = NewService().UpsertTransferredFile(new FilePath("/a/b/x.prg"), 10);

        created.Should().BeEmpty();
        SubfolderPaths("/").Should().Equal("/a/");
        SubfolderPaths("/a/").Should().Equal("/a/b/");
        FileNames("/a/b/").Should().Equal("x.prg");
    }

    [Fact]
    public async Task ReadDirectory_CacheMissInsideAHeldParent_ListsTheNewFolderThere()
    {
        Hold("/a/");
        GivenDirectoryReply(Listing("/a/new/", "/a/new/x.prg"));

        await NewService().ReadDirectory(new DirectoryPath("/a/new/"));

        SubfolderPaths("/a/").Should().Equal("/a/new/");
    }

    [Fact]
    public async Task ReadDirectory_CacheMissWhoseParentIsNotHeld_CreatesNoParentEntry()
    {
        GivenDirectoryReply(Listing("/a/new/", "/a/new/x.prg"));

        await NewService().ReadDirectory(new DirectoryPath("/a/new/"));

        _cache.GetByDirPath(new DirectoryPath("/a/new/")).Should().NotBeNull();
        _cache.GetByDirPath(new DirectoryPath("/a/")).Should().BeNull();
    }

    [Fact]
    public async Task Cache_PartialIndexOfASubfolder_LeavesTheParentListingIt()
    {
        Hold("/a/");
        GivenDirectoryReply(new GetDirectoryRecursiveResult
        {
            DirectoryContent =
            [
                new DirectoryContent { Path = new DirectoryPath("/a/sub/"), Directories = [new DirectoryItem("/a/sub/inner")] },
                new DirectoryContent { Path = new DirectoryPath("/a/sub/inner/"), Files = [File("/a/sub/inner/x.prg")] }
            ]
        });

        var cached = await NewService().Cache(new DirectoryPath("/a/sub/"), CancellationToken.None);

        cached.Should().BeTrue();
        SubfolderPaths("/a/").Should().Equal("/a/sub/");
        SubfolderPaths("/a/sub/").Should().Equal("/a/sub/inner/");
        FileNames("/a/sub/inner/").Should().Equal("x.prg");
    }
}
