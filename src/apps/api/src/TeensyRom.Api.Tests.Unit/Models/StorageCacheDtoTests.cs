using TeensyRom.Api.Models;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Storage;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Tests.Unit.Models;

public class StorageCacheDtoTests
{
    [Fact]
    public void FromCache_KeepsPlainFiles_TypedUnknown()
    {
        var cache = new StorageCacheItem
        {
            Path = new DirectoryPath("/games/"),
            Directories = [],
            Files =
            [
                new FileItem { Name = "Disk.d64", Path = new FilePath("/games/Disk.d64") },
                new GameItem { Name = "Game.prg", Path = new FilePath("/games/Game.prg") }
            ]
        };

        var dto = StorageCacheDto.FromCache(cache);

        dto.Files.Should().HaveCount(2);

        var disk = dto.Files.Should().ContainSingle(f => f.Name == "Disk.d64").Subject;
        disk.Type.Should().Be(FileItemType.Unknown);
        disk.IsCompatible.Should().BeTrue();

        var game = dto.Files.Should().ContainSingle(f => f.Name == "Game.prg").Subject;
        game.Type.Should().Be(FileItemType.Game);
    }
}
