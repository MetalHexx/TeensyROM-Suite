using TeensyRom.Api.Transfers;

namespace TeensyRom.Api.Tests.Unit.Transfers;

public class TransferExclusionsTests
{
    [Theory]
    [InlineData(".DS_Store", true)]
    [InlineData("games/.hidden/x.prg", true)]
    [InlineData("._game.prg", true)]
    [InlineData("sub/._game.prg", true)]
    [InlineData("__MACOSX/x.sid", true)]
    [InlineData("pack/__macosx/x.sid", true)]
    [InlineData("THUMBS.DB", true)]
    [InlineData("sub/desktop.ini", true)]
    [InlineData("sub\\Thumbs.db", true)]
    [InlineData("games\\.hidden\\x.prg", true)]
    [InlineData("game.prg", false)]
    [InlineData("my.games/x.prg", false)]
    [InlineData("games/thumbs.db.prg", false)]
    [InlineData("Thumbs.db/x.prg", false)]
    [InlineData("a//game.prg", false)]
    [InlineData("a//.game.prg", true)]
    [InlineData("", false)]
    public void IsExcluded_FlagsDotNamesMacResidueAndExcludedFileNames_ByAnySegment(string relativePath, bool expected)
    {
        TransferExclusions.IsExcluded(relativePath).Should().Be(expected);
    }

    [Theory]
    [InlineData("x.crdownload", true)]
    [InlineData("x.PART", true)]
    [InlineData("pack.zip.crdownload", true)]
    [InlineData("x.prg", false)]
    [InlineData("part", false)]
    [InlineData("x.part.prg", false)]
    public void IsPartialDownload_MatchesBrowserSuffixesCaseInsensitively(string path, bool expected)
    {
        TransferExclusions.IsPartialDownload(path).Should().Be(expected);
    }
}
