using System.ComponentModel.DataAnnotations;
using TeensyRom.Core.Entities.Transfers;

namespace TeensyRom.Api.Models
{
    /// <summary>How many files a transfer skipped for one reason, and for an unsupported type, which types.</summary>
    public class TransferSkipDto
    {
        [Required] public TransferSkipReason Reason { get; set; }
        [Required] public int Count { get; set; }
        [Required] public List<string> Types { get; set; } = [];

        public static TransferSkipDto From(TransferSkip skip) => new()
        {
            Reason = skip.Reason,
            Count = skip.Count,
            Types = [.. skip.Types]
        };
    }
}
