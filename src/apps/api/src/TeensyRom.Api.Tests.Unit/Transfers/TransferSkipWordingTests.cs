using TeensyRom.Core.Entities.Transfers;

namespace TeensyRom.Api.Tests.Unit.Transfers;

public class TransferSkipWordingTests
{
    [Fact]
    public void Describe_JoinsReasonsInEnumOrder_WithTypesOrderedAndNoExtensionLast()
    {
        var wording = TransferSkipWording.Describe(
        [
            new TransferSkip(TransferSkipReason.PartialDownload, 1, []),
            new TransferSkip(TransferSkipReason.HiddenOrSystem, 1, []),
            new TransferSkip(TransferSkipReason.UnsupportedType, 3, [TransferSkipTally.NoExtension, ".bin", ".xyz"])
        ]);

        wording.Should().Be(
            "3 files skipped (.bin, .xyz, no extension): not a file type the TeensyROM takes; 1 hidden or system file skipped; 1 unfinished download skipped.");
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
            "1 file skipped (.doc): not a file type the TeensyROM takes; 1 hidden or system file skipped; 1 unfinished download skipped.");
    }

    [Fact]
    public void Describe_UnsupportedTypeWithNoTypes_OmitsTheParentheses() =>
        TransferSkipWording.Describe([new TransferSkip(TransferSkipReason.UnsupportedType, 2, [])])
            .Should().Be("2 files skipped: not a file type the TeensyROM takes.");

    [Fact]
    public void Describe_WithNoSkips_IsEmpty() => TransferSkipWording.Describe([]).Should().BeEmpty();
}
