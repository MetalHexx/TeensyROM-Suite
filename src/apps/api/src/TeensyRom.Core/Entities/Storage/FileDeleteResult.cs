namespace TeensyRom.Core.Entities.Storage
{
    public enum FileDeleteOutcome { Deleted, NotFound, IsDirectory, Failed }

    /// <summary>Outcome of deleting a file: deleted, absent, a folder (refused), or the delete itself failed.</summary>
    public sealed class FileDeleteResult
    {
        public FileDeleteOutcome Outcome { get; init; }

        /// <summary>The device's or the read's message; set only when Outcome is Failed.</summary>
        public string? Failure { get; init; }

        public static FileDeleteResult Deleted() => new() { Outcome = FileDeleteOutcome.Deleted };
        public static FileDeleteResult NotFound() => new() { Outcome = FileDeleteOutcome.NotFound };
        public static FileDeleteResult IsDirectory() => new() { Outcome = FileDeleteOutcome.IsDirectory };
        public static FileDeleteResult Failed(string message) => new() { Outcome = FileDeleteOutcome.Failed, Failure = message };
    }
}
