using TeensyRom.Core.Entities.Transfers;

namespace TeensyRom.Api.Tests.Unit.Transfers;

internal static class TransferSkipAssertions
{
    /// <summary>The skips equal the expected ones, in order, comparing their type lists by content.</summary>
    public static void ShouldEqualSkips(this IReadOnlyList<TransferSkip> actual, params TransferSkip[] expected) =>
        actual.Should().BeEquivalentTo(expected, options => options.WithStrictOrdering());
}
