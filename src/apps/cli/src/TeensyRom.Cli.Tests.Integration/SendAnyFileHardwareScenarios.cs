using System.IO.Compression;
using System.Text.Json;
using TeensyRom.Cli.Api.Generated;
using TeensyRom.Cli.Errors;
using ApiStorageType = TeensyRom.Cli.Api.Generated.TeensyStorageType;

namespace TeensyRom.Cli.Tests.Integration;

/// <summary>
/// Sending any file type, delete, the transfer switches and watch folders on a real TeensyROM. Each scenario writes only
/// under its own <c>/bench-send-any-file/a/&lt;run-id&gt;</c> (or <c>a03/&lt;run-id&gt;</c>) folder and deletes its files
/// afterwards; the empty folders stay, because the firmware can't remove them.
/// </summary>
public sealed partial class HardwareScenarios
{
    private const string BenchRoot = "/bench-send-any-file/a";

    private static string NewRunFolder() => $"{BenchRoot}/{Guid.NewGuid().ToString("N")[..12]}";

    private static string[] Names(JsonElement listing) => FilePaths(listing).Select(path => path[(path.LastIndexOf('/') + 1)..]).Order().ToArray();

    private static async Task DeleteQuietlyAsync(CartDto device, string storage, params string[] paths)
    {
        using var cli = new CliHarness();

        await cli.RunAsync(["file", "delete", .. paths, "--device", device.DeviceId, "--storage", storage, "--yes", "--json"]);
    }

    /// <summary>Uploads one tiny program as <paramref name="name"/> into <paramref name="folder"/> and returns its device path.</summary>
    private static async Task<string> UploadProgramAsync(CartDto device, string storage, string folder, string name)
    {
        var local = NewLocalFolder();

        try
        {
            var file = WriteProgram(local, name);
            var upload = await RunJsonAsync("file", "upload", file, "--to", folder, "--device", device.DeviceId, "--storage", storage, "--json");

            upload.ExitCode.Should().Be(0, upload.Error);

            return $"{folder}/{name}";
        }
        finally
        {
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// Runs <paramref name="body"/> with the engine's all-types and all-in-archives switches off, and puts them back as they were.
    /// The switches belong to the test engine's own home.
    /// </summary>
    private static async Task WithTypeSwitchesOffAsync(Func<Task> body)
    {
        var original = await RunJsonAsync("transfer", "settings", "--json");
        var allTypes = original.Json.GetProperty("allTypes").GetBoolean();
        var allInArchives = original.Json.GetProperty("allInArchives").GetBoolean();

        try
        {
            (await RunJsonAsync("transfer", "set", "all-types", "false", "--json")).ExitCode.Should().Be(0);
            (await RunJsonAsync("transfer", "set", "all-in-archives", "false", "--json")).ExitCode.Should().Be(0);

            await body();
        }
        finally
        {
            await RunJsonAsync("transfer", "set", "all-types", allTypes.ToString().ToLowerInvariant(), "--json");
            await RunJsonAsync("transfer", "set", "all-in-archives", allInArchives.ToString().ToLowerInvariant(), "--json");
        }
    }

    /// <summary>A file you name is sent whatever its type: <c>notes.xyz</c> and a <c>.bin</c> land and list as not launchable.</summary>
    [SkippableFact]
    public async Task FileUpload_NamedUnknownTypeAndBinFiles_AreSent_AndListedNotLaunchable()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var local = NewLocalFolder();

        try
        {
            File.WriteAllText(Path.Combine(local, "notes.xyz"), "plain words");
            File.WriteAllBytes(Path.Combine(local, "blob.bin"), [0xDE, 0xAD, 0xBE, 0xEF]);

            var upload = await RunJsonAsync(
                "file", "upload", Path.Combine(local, "notes.xyz"), Path.Combine(local, "blob.bin"), "--to", run, "--device", device.DeviceId, "--storage", storage, "--json");

            upload.ExitCode.Should().Be(0, upload.Error);
            upload.Json.GetProperty("totals").GetProperty("copied").GetInt32().Should().Be(2);
            var listing = await ListAsync(run, device.DeviceId, storage);
            Names(listing.Json).Should().Equal("blob.bin", "notes.xyz");
            listing.Json.GetProperty("files").EnumerateArray().Select(file => file.GetProperty("launchable").GetBoolean()).Should().AllBeEquivalentTo(false);
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, $"{run}/notes.xyz", $"{run}/blob.bin");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// A folder walk without --all-types sends the known types and says how many files it left out; with --all-types it
    /// sends everything.
    /// </summary>
    [SkippableFact]
    public async Task FileUpload_AFolderWalk_LeavesOutUnknownTypesUnlessAllTypes()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var local = NewLocalFolder();

        try
        {
            WriteProgram(local, "walk/game.prg");
            File.WriteAllText(Path.Combine(local, "walk", "readme.txt"), "known");
            File.WriteAllText(Path.Combine(local, "walk", "notes.xyz"), "unknown");
            File.WriteAllBytes(Path.Combine(local, "walk", "blob.bin"), [1, 2, 3]);

            await WithTypeSwitchesOffAsync(async () =>
            {
                var plain = await RunJsonAsync("file", "upload", Path.Combine(local, "walk"), "--to", $"{run}/plain", "--device", device.DeviceId, "--storage", storage, "--json");

                plain.ExitCode.Should().Be(0, plain.Error);
                plain.Error.Should().Contain("2 files left out (.bin, .xyz): not a file type the TeensyROM takes.");
                plain.Json.GetProperty("skipped")[0].GetProperty("count").GetInt32().Should().Be(2);
                Names((await ListAsync($"{run}/plain/walk", device.DeviceId, storage)).Json).Should().Equal("game.prg", "readme.txt");

                var all = await RunJsonAsync("file", "upload", Path.Combine(local, "walk"), "--all-types", "--to", $"{run}/all", "--device", device.DeviceId, "--storage", storage, "--json");

                all.ExitCode.Should().Be(0, all.Error);
                all.Error.Should().NotContain("left out");
                Names((await ListAsync($"{run}/all/walk", device.DeviceId, storage)).Json).Should().Equal("blob.bin", "game.prg", "notes.xyz", "readme.txt");
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage,
                $"{run}/plain/walk/game.prg", $"{run}/plain/walk/readme.txt",
                $"{run}/all/walk/game.prg", $"{run}/all/walk/readme.txt", $"{run}/all/walk/notes.xyz", $"{run}/all/walk/blob.bin");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// Naming a dot-named folder sends its contents, with a <c>.cache/</c> below it skipped; a browser's unfinished
    /// downloads are counted in the skip report with the hidden folder's file and the unknown type.
    /// </summary>
    [SkippableFact]
    public async Task FileUpload_ADotNamedFolder_SendsItsContents_SkippingHiddenFoldersAndPartialDownloads()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var local = NewLocalFolder();

        try
        {
            WriteProgram(local, ".stash/game.prg");
            WriteProgram(local, ".stash/.cache/hidden.prg");
            File.WriteAllBytes(Path.Combine(local, ".stash", "movie.crdownload"), [1]);
            File.WriteAllBytes(Path.Combine(local, ".stash", "game.part"), [2]);
            File.WriteAllText(Path.Combine(local, ".stash", "notes.xyz"), "unknown");

            await WithTypeSwitchesOffAsync(async () =>
            {
                var upload = await RunJsonAsync("file", "upload", Path.Combine(local, ".stash"), "--to", run, "--device", device.DeviceId, "--storage", storage, "--json");

                upload.ExitCode.Should().Be(0, upload.Error);
                upload.Json.GetProperty("totals").GetProperty("copied").GetInt32().Should().Be(1);
                upload.Error.Should().Contain("1 file left out (.xyz): not a file type the TeensyROM takes; 1 hidden or system file left out; 2 unfinished downloads left out.");
                upload.Json.GetProperty("skipped").EnumerateArray().Select(skip => skip.GetProperty("reason").GetString())
                    .Should().Equal("unsupportedType", "hiddenOrSystem", "partialDownload");
                var listing = await ListAsync($"{run}/.stash", device.DeviceId, storage);
                Names(listing.Json).Should().Equal("game.prg");
                listing.Json.GetProperty("directories").EnumerateArray().Should().BeEmpty();
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, $"{run}/.stash/game.prg");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// An archive's hidden and <c>__MACOSX</c> entries never land. Its other entries land by type: everything with
    /// --all-in-archives, the types the TeensyROM takes without it.
    /// </summary>
    [SkippableFact]
    public async Task FileUpload_AZip_LandsByType_AndNeverItsHiddenOrMacosxEntries()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var local = NewLocalFolder();

        try
        {
            var archive = Path.Combine(local, "pack.zip");

            using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
            {
                foreach (var entry in new[] { "game.prg", "notes.doc", "__MACOSX/game.prg", "._hidden.prg" })
                {
                    await using var stream = zip.CreateEntry(entry).Open();
                    await stream.WriteAsync(TinyProgram);
                }
            }

            await WithTypeSwitchesOffAsync(async () =>
            {
                var with = await RunJsonAsync("file", "upload", archive, "--all-in-archives", "--to", $"{run}/with", "--device", device.DeviceId, "--storage", storage, "--json");

                with.ExitCode.Should().Be(0, with.Error);
                Names((await ListAsync($"{run}/with/pack", device.DeviceId, storage)).Json).Should().Equal("game.prg", "notes.doc");

                var without = await RunJsonAsync("file", "upload", archive, "--to", $"{run}/without", "--device", device.DeviceId, "--storage", storage, "--json");

                without.ExitCode.Should().Be(0, without.Error);
                Names((await ListAsync($"{run}/without/pack", device.DeviceId, storage)).Json).Should().Equal("game.prg");
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, $"{run}/with/pack/game.prg", $"{run}/with/pack/notes.doc", $"{run}/without/pack/game.prg");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// Launching a file of an unknown type fails cleanly: the CLI finds the file isn't launchable and exits 7 without asking the
    /// engine, and the engine's own launch endpoint answers 400.
    /// </summary>
    [SkippableFact]
    public async Task FileLaunch_OfAnUnknownTypeFile_FailsCleanly_ThroughTheCliAndTheEngine()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var local = NewLocalFolder();
        var path = $"{run}/notes.xyz";

        try
        {
            File.WriteAllText(Path.Combine(local, "notes.xyz"), "plain words");
            (await RunJsonAsync("file", "upload", Path.Combine(local, "notes.xyz"), "--to", run, "--device", device.DeviceId, "--storage", storage, "--json")).ExitCode.Should().Be(0);

            var launch = await RunJsonAsync("file", "launch", path, "--device", device.DeviceId, "--storage", storage, "--json");

            launch.ExitCode.Should().Be((int)CliExitCode.NotLaunchable);
            launch.Error.Should().Contain("notLaunchable").And.Contain($"{path} isn't a file the TeensyROM can launch.");

            var direct = async () => await api.Api.LaunchFileAsync(device.DeviceId, storage == "sd" ? ApiStorageType.SD : ApiStorageType.USB, path);

            (await direct.Should().ThrowAsync<ApiException>()).Which.StatusCode.Should().Be(400);
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, path);
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary><c>transfer settings</c> reads the test engine's switches and <c>transfer set</c> changes one, which is then set back.</summary>
    [SkippableFact]
    public async Task TransferSettings_ReadAndChangeASwitch_ThenPutItBack()
    {
        Skip.If(api.OnlineDevices.Count == 0, "no TeensyROM is online in the test API");
        var original = await RunJsonAsync("transfer", "settings", "--json");
        original.ExitCode.Should().Be(0, original.Error);
        var before = original.Json.GetProperty("allInArchives").GetBoolean();
        var flipped = (!before).ToString().ToLowerInvariant();

        try
        {
            var set = await RunJsonAsync("transfer", "set", "all-in-archives", flipped, "--json");

            set.ExitCode.Should().Be(0, set.Error);
            set.Json.GetProperty("allInArchives").GetBoolean().Should().Be(!before);
            (await RunJsonAsync("transfer", "settings", "--json")).Json.GetProperty("allInArchives").GetBoolean().Should().Be(!before);
        }
        finally
        {
            await RunJsonAsync("transfer", "set", "all-in-archives", before.ToString().ToLowerInvariant(), "--json");
        }
        (await RunJsonAsync("transfer", "settings", "--json")).Json.GetProperty("allInArchives").GetBoolean().Should().Be(before);
    }

    /// <summary>
    /// Adds a watch folder that takes every type, changes and lists it, adds it for the second cart too (which answers
    /// <c>created: false</c> with a notice), then removes it. Nothing ever lands in the folder, so nothing is sent.
    /// </summary>
    [SkippableFact]
    public async Task WatchFolder_AddAllTypes_SetListAddForSecondCart_ThenRemove()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var folder = Directory.CreateTempSubdirectory("trom-bench-watch-").FullName;

        try
        {
            var added = await RunJsonAsync("watch-folder", "add", folder, "--all-types", "--device", device.DeviceId, "--storage", storage, "--path", $"{run}/watch", "--json");

            added.ExitCode.Should().Be(0, added.Error);
            added.Json.GetProperty("created").GetBoolean().Should().BeTrue();
            added.Json.GetProperty("folder").GetProperty("allTypes").GetBoolean().Should().BeTrue();
            var id = added.Json.GetProperty("folder").GetProperty("id").GetString();

            var set = await RunJsonAsync("watch-folder", "set", folder, "--all-in-archives", "--json");

            set.ExitCode.Should().Be(0, set.Error);
            set.Json.GetProperty("allInArchives").GetBoolean().Should().BeTrue();
            set.Json.GetProperty("allTypes").GetBoolean().Should().BeTrue();

            var listed = await RunJsonAsync("watch-folder", "list", "--json");

            listed.Json.EnumerateArray().Single(watched => watched.GetProperty("id").GetString() == id).GetProperty("allInArchives").GetBoolean().Should().BeTrue();

            if (api.OnlineDevices.Count > 1)
            {
                var other = api.OnlineDevices[1];
                var otherStorage = CliServices.AvailableStorageOrSkip(other) == TeensyRom.Cli.Storage.Entities.TeensyStorageType.SD ? "sd" : "usb";

                var again = await RunJsonAsync("watch-folder", "add", folder, "--all-types", "--device", other.DeviceId, "--storage", otherStorage, "--path", $"{run}/watch-b", "--json");

                again.ExitCode.Should().Be(0, again.Error);
                again.Json.GetProperty("created").GetBoolean().Should().BeFalse();
                again.Error.Should().Contain("was already watched");
                again.Json.GetProperty("folder").GetProperty("destinations").GetArrayLength().Should().Be(2);
            }

            var removed = await RunJsonAsync("watch-folder", "remove", folder, "--json");

            removed.ExitCode.Should().Be(0, removed.Error);
            removed.Json.GetProperty("folderRemoved").GetBoolean().Should().BeTrue();
            (await RunJsonAsync("watch-folder", "list", "--json")).Json.EnumerateArray().Select(watched => watched.GetProperty("id").GetString()).Should().NotContain(id);
        }
        finally
        {
            using var cleanup = new CliHarness();
            await cleanup.RunAsync("watch-folder", "remove", folder);
            Directory.Delete(folder, recursive: true);
        }
    }

    /// <summary>A file you uploaded can be deleted, and is gone from the listing.</summary>
    [SkippableFact]
    public async Task FileDelete_AnUploadedFile_IsDeleted_AndGoneFromTheListing()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var path = string.Empty;

        try
        {
            path = await UploadProgramAsync(device, storage, run, "doomed.prg");
            FilePaths((await ListAsync(run, device.DeviceId, storage)).Json).Should().Contain(path);

            var delete = await RunJsonAsync("file", "delete", path, "--yes", "--device", device.DeviceId, "--storage", storage, "--json");

            delete.ExitCode.Should().Be(0, delete.Error);
            delete.Json[0].GetProperty("ok").GetBoolean().Should().BeTrue();
            FilePaths((await ListAsync(run, device.DeviceId, storage)).Json).Should().NotContain(path);
        }
        finally
        {
            if (path.Length > 0) await DeleteQuietlyAsync(device, storage, path);
        }
    }

    /// <summary>A folder path is refused: only files can be deleted, and the folder stays.</summary>
    [SkippableFact]
    public async Task FileDelete_AFolderPath_IsRefused_WithExitOne()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var path = string.Empty;

        try
        {
            path = await UploadProgramAsync(device, storage, run, "anchor.prg");
            using var cli = new CliHarness();

            var exitCode = await cli.RunAsync("file", "delete", run, "--yes", "--device", device.DeviceId, "--storage", storage, "--json");

            exitCode.Should().Be((int)CliExitCode.Failed);
            (cli.Output + cli.Error).Should().Contain("Only files can be deleted");
            FilePaths((await ListAsync(run, device.DeviceId, storage)).Json).Should().Contain(path);
        }
        finally
        {
            if (path.Length > 0) await DeleteQuietlyAsync(device, storage, path);
        }
    }

    /// <summary>Without --yes and with no terminal to ask in, delete is a usage error (exit 2) and the file is still there.</summary>
    [SkippableFact]
    public async Task FileDelete_WithoutYesAndNoTerminal_IsAUsageError_AndTheFileStays()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var path = string.Empty;

        try
        {
            path = await UploadProgramAsync(device, storage, run, "kept.prg");

            var delete = await RunJsonAsync("file", "delete", path, "--device", device.DeviceId, "--storage", storage, "--json");

            delete.ExitCode.Should().Be((int)CliExitCode.Usage);
            FilePaths((await ListAsync(run, device.DeviceId, storage)).Json).Should().Contain(path);
        }
        finally
        {
            if (path.Length > 0) await DeleteQuietlyAsync(device, storage, path);
        }
    }

    /// <summary>Deleting a file that isn't there exits 5.</summary>
    [SkippableFact]
    public async Task FileDelete_AMissingFile_ExitsNotFound()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewRunFolder();
        var path = string.Empty;

        try
        {
            path = await UploadProgramAsync(device, storage, run, "anchor.prg");

            var delete = await RunJsonAsync("file", "delete", $"{run}/not-there.prg", "--yes", "--device", device.DeviceId, "--storage", storage, "--json");

            delete.ExitCode.Should().Be((int)CliExitCode.NotFound);
            delete.Json[0].GetProperty("ok").GetBoolean().Should().BeFalse();
        }
        finally
        {
            if (path.Length > 0) await DeleteQuietlyAsync(device, storage, path);
        }
    }

    private const string A03Root = "/bench-send-any-file/a03";

    private static string NewA03Folder() => $"{A03Root}/{Guid.NewGuid().ToString("N")[..12]}";

    /// <summary>Runs <paramref name="body"/> with the engine's auto-launch switch set to <paramref name="on"/>, and puts it back as it was.</summary>
    private static async Task WithAutoLaunchAsync(bool on, Func<Task> body)
    {
        var original = (await RunJsonAsync("transfer", "settings", "--json")).Json.GetProperty("autoLaunch").GetBoolean();

        try
        {
            (await RunJsonAsync("transfer", "set", "auto-launch", on.ToString().ToLowerInvariant(), "--json")).ExitCode.Should().Be(0);

            await body();
        }
        finally
        {
            await RunJsonAsync("transfer", "set", "auto-launch", original.ToString().ToLowerInvariant(), "--json");
        }
    }

    /// <summary>Auto-launch off and both type switches off: the settings the skip and archive scenarios assume.</summary>
    private static Task WithPlainSettingsAsync(Func<Task> body) => WithAutoLaunchAsync(false, () => WithTypeSwitchesOffAsync(body));

    private static JsonElement? SkipOf(JsonElement upload, string reason) =>
        upload.GetProperty("skipped").EnumerateArray().Where(skip => skip.GetProperty("reason").GetString() == reason).Select(skip => (JsonElement?)skip).SingleOrDefault();

    private static string[] Types(JsonElement skip) => skip.GetProperty("types").EnumerateArray().Select(type => type.GetString()!).ToArray();

    private static string[] DirectoryPaths(JsonElement listing) =>
        listing.GetProperty("directories").EnumerateArray().Select(directory => directory.GetProperty("path").GetString()!.TrimEnd('/')).ToArray();

    /// <summary>A file the TeensyROM can't launch, once on the cart, exits 7 from <c>file launch</c>; a path that isn't there still exits 5.</summary>
    [SkippableFact]
    public async Task FileLaunch_OfABinFile_ExitsNotLaunchable_AndAMissingPathExitsNotFound()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var local = NewLocalFolder();
        var path = $"{run}/notes.bin";

        try
        {
            File.WriteAllBytes(Path.Combine(local, "notes.bin"), [1, 2, 3, 4]);

            await WithAutoLaunchAsync(false, async () =>
            {
                var upload = await RunJsonAsync("file", "upload", Path.Combine(local, "notes.bin"), "--to", run, "--device", device.DeviceId, "--storage", storage, "--json");

                upload.ExitCode.Should().Be(0, upload.Error);

                var launch = await RunJsonAsync("file", "launch", path, "--device", device.DeviceId, "--storage", storage, "--json");

                launch.ExitCode.Should().Be((int)CliExitCode.NotLaunchable, launch.Error);
                launch.Error.Should().Contain("notLaunchable");

                var missing = await RunJsonAsync("file", "launch", $"{run}/missing.prg", "--device", device.DeviceId, "--storage", storage, "--json");

                missing.ExitCode.Should().Be((int)CliExitCode.NotFound, missing.Error);
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, path);
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// A folder walk reports what it left out by reason: without --all-types the unknown types, the hidden file and the
    /// unfinished download; with it, only the last two.
    /// </summary>
    [SkippableFact]
    public async Task FileUpload_AFolderWalk_ReportsItsSkipsByReason()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var local = NewLocalFolder();

        try
        {
            WriteProgram(local, "walk/a.prg");
            WriteProgram(local, "walk/.hidden.prg");
            File.WriteAllText(Path.Combine(local, "walk", "b.xyz"), "unknown");
            File.WriteAllBytes(Path.Combine(local, "walk", "c.bin"), [1, 2, 3]);
            File.WriteAllBytes(Path.Combine(local, "walk", "x.crdownload"), [1]);

            await WithPlainSettingsAsync(async () =>
            {
                var plain = await RunJsonAsync("file", "upload", Path.Combine(local, "walk"), "--to", $"{run}/plain", "--device", device.DeviceId, "--storage", storage, "--json");

                plain.ExitCode.Should().Be(0, plain.Error);
                var unsupported = SkipOf(plain.Json, "unsupportedType");
                unsupported.Should().NotBeNull();
                unsupported!.Value.GetProperty("count").GetInt32().Should().Be(2);
                Types(unsupported.Value).Should().Equal(".bin", ".xyz");
                SkipOf(plain.Json, "hiddenOrSystem")!.Value.GetProperty("count").GetInt32().Should().Be(1);
                SkipOf(plain.Json, "partialDownload")!.Value.GetProperty("count").GetInt32().Should().Be(1);

                var all = await RunJsonAsync("file", "upload", Path.Combine(local, "walk"), "--all-types", "--to", $"{run}/all", "--device", device.DeviceId, "--storage", storage, "--json");

                all.ExitCode.Should().Be(0, all.Error);
                SkipOf(all.Json, "unsupportedType").Should().BeNull();
                SkipOf(all.Json, "hiddenOrSystem")!.Value.GetProperty("count").GetInt32().Should().Be(1);
                SkipOf(all.Json, "partialDownload")!.Value.GetProperty("count").GetInt32().Should().Be(1);
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage,
                $"{run}/plain/walk/a.prg",
                $"{run}/all/walk/a.prg", $"{run}/all/walk/b.xyz", $"{run}/all/walk/c.bin");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// A zip lands its <c>x.prg</c> and its <c>./y.prg</c> without --all-in-archives, and the job's own skips (the unknown
    /// type, the hidden and <c>__MACOSX</c> entries) come back in <c>skipped</c>.
    /// </summary>
    [SkippableFact]
    public async Task FileUpload_AZip_LandsItsProgramsIncludingADotSlashEntry_AndReportsItsSkips()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var local = NewLocalFolder();

        try
        {
            var archive = Path.Combine(local, "pack.zip");

            using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
            {
                foreach (var entry in new[] { "x.prg", "./y.prg", "notes.doc", "__MACOSX/a", "._x" })
                {
                    await using var stream = zip.CreateEntry(entry).Open();
                    await stream.WriteAsync(TinyProgram);
                }
            }

            await WithPlainSettingsAsync(async () =>
            {
                var upload = await RunJsonAsync("file", "upload", archive, "--to", run, "--device", device.DeviceId, "--storage", storage, "--json");

                upload.ExitCode.Should().Be(0, upload.Error);
                Names((await ListAsync($"{run}/pack", device.DeviceId, storage)).Json).Should().Equal("x.prg", "y.prg");
                var unsupported = SkipOf(upload.Json, "unsupportedType");
                unsupported.Should().NotBeNull("the job's skips arrive in the report");
                Types(unsupported!.Value).Should().Equal(".doc");
                SkipOf(upload.Json, "hiddenOrSystem").Should().NotBeNull();
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, $"{run}/pack/x.prg", $"{run}/pack/y.prg");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>A folder holding only a file of an unknown type, and an empty folder, are both exit 0 with an empty <c>files</c> list.</summary>
    [SkippableFact]
    public async Task FileUpload_NothingToSend_ExitsZero_WithNoFiles()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var local = NewLocalFolder();

        try
        {
            Directory.CreateDirectory(Path.Combine(local, "unknown-only"));
            File.WriteAllText(Path.Combine(local, "unknown-only", "b.xyz"), "unknown");
            Directory.CreateDirectory(Path.Combine(local, "empty"));

            await WithPlainSettingsAsync(async () =>
            {
                foreach (var folder in new[] { "unknown-only", "empty" })
                {
                    var upload = await RunJsonAsync("file", "upload", Path.Combine(local, folder), "--to", run, "--device", device.DeviceId, "--storage", storage, "--json");

                    upload.ExitCode.Should().Be(0, $"{folder}: {upload.Error}");
                    upload.Json.GetProperty("files").GetArrayLength().Should().Be(0, folder);
                }
            });
        }
        finally
        {
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>With auto-launch on, an upload of one program carries <c>launched.status: "launched"</c>.</summary>
    [SkippableFact]
    public async Task FileUpload_OneProgramWithAutoLaunchOn_CarriesTheLaunchResult()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var local = NewLocalFolder();

        try
        {
            var file = WriteProgram(local, "auto.prg");

            await WithAutoLaunchAsync(true, async () =>
            {
                var upload = await RunJsonAsync("file", "upload", file, "--to", run, "--device", device.DeviceId, "--storage", storage, "--json");

                await RunJsonAsync("file", "stop", "--device", device.DeviceId, "--json");

                upload.ExitCode.Should().Be(0, upload.Error);
                upload.Json.GetProperty("launched").GetProperty("status").GetString().Should().Be("launched");
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, $"{run}/auto.prg");
            Directory.Delete(local, recursive: true);
        }
    }

    /// <summary>
    /// An upload into new nested folders shows up in the listings right away: the chain of folders and the file, and a
    /// second file beside it.
    /// </summary>
    [SkippableFact]
    public async Task FileUpload_IntoNewNestedFolders_ListsTheChainAndBothFiles()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var n2 = $"{run}/n1/n2";

        try
        {
            await WithAutoLaunchAsync(false, async () =>
            {
                await UploadProgramAsync(device, storage, n2, "x.prg");

                DirectoryPaths((await ListAsync($"{run}/", device.DeviceId, storage)).Json).Should().Contain($"{run}/n1");
                DirectoryPaths((await ListAsync($"{run}/n1/", device.DeviceId, storage)).Json).Should().Contain(n2);
                Names((await ListAsync($"{n2}/", device.DeviceId, storage)).Json).Should().Equal("x.prg");

                await UploadProgramAsync(device, storage, n2, "z.prg");

                Names((await ListAsync($"{n2}/", device.DeviceId, storage)).Json).Should().Equal("x.prg", "z.prg");
            });
        }
        finally
        {
            await DeleteQuietlyAsync(device, storage, $"{n2}/x.prg", $"{n2}/z.prg");
        }
    }

    /// <summary><c>file ls --refresh</c> re-reads the folder from the cart: it exits 0 and lists what the cart holds.</summary>
    [SkippableFact]
    public async Task FileLs_WithRefresh_ListsWhatTheCartHolds()
    {
        var (device, storage) = BenchDeviceOrSkip();
        var run = NewA03Folder();
        var path = string.Empty;

        try
        {
            await WithAutoLaunchAsync(false, async () =>
            {
                path = await UploadProgramAsync(device, storage, run, "kept.prg");

                var refreshed = await RunJsonAsync("file", "ls", $"{run}/", "--refresh", "--device", device.DeviceId, "--storage", storage, "--json");

                refreshed.ExitCode.Should().Be(0, refreshed.Error);
                Names(refreshed.Json).Should().Equal("kept.prg");
            });
        }
        finally
        {
            if (path.Length > 0) await DeleteQuietlyAsync(device, storage, path);
        }
    }
}
