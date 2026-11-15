using TeensyRom.Core.Entities.Transfers;

namespace TeensyRom.Api.Tests.Unit.Transfers;

public class TransferSkipWordingTests
{
    [Fact]
    public void Describe_JoinsReasonsInEnumOrder_EndingWithAPeriod()
    {
        var wording = TransferSkipWording.Describe(
        [
            new TransferSkip(TransferSkipReason.PartialDownload, 3, []),
            new TransferSkip(TransferSkipReason.HiddenOrSystem, 2, []),
            new TransferSkip(TransferSkipReason.UnsupportedType, 3, [".bin", ".xyz"])
        ]);

        wording.Should().Be(
            "3 files left out (.bin, .xyz): not a file type the TeensyROM takes; 2 hidden or system files left out; 3 unfinished downloads left out.");
    }

    [Fact]
    public void Describe_UsesTheSingularForOne()
    {
        TransferSkipWording.Describe(
        [
            new TransferSkip(TransferSkipReason.UnsupportedType, 1, [".doc"]),
            new TransferSkip(TransferSkipReason.HiddenOrSystem, 1, []),
            new TransferSkip(TransferSkipReason.PartialDownload, 1, [])
        ]).Should().Be(
            "1 file left out (.doc): not a file type the TeensyROM takes; 1 hidden or system file left out; 1 unfinished download left out.");
    }

    [Fact]
    public void Describe_WithNoSkips_IsEmpty() => TransferSkipWording.Describe([]).Should().BeEmpty();
}
