using TeensyRom.Cli.Api;
using TeensyRom.Cli.Output;
using TeensyRom.Cli.Settings;

namespace TeensyRom.Cli.Commands.Index;

/// <summary>What <c>index build</c> and <c>file ls --refresh</c> share: showing tr-web's indexing lines on stderr, and remembering that an index ran.</summary>
internal static class IndexProgress
{
    /// <summary>
    /// Shows tr-web's indexing lines on stderr while indexing runs. When the log can't be followed it says so and
    /// returns a handle that does nothing: indexing still runs.
    /// </summary>
    public static async Task<IAsyncDisposable> FollowAsync(ICliOutput output, Func<CancellationToken, Task<IAsyncDisposable>> follow, CancellationToken ct)
    {
        try
        {
            return await follow(ct);
        }
        catch (TeensyApiException ex)
        {
            output.Notice($"Indexing will run without showing its progress. {ex.Message}");
            return NoProgress.Instance;
        }
    }

    public static void ShowLine(ICliOutput output, string line)
    {
        if (line.Contains("Indexing", StringComparison.Ordinal)) output.Notice(line);
    }

    public static void ShowLine(ICliOutput output, string deviceId, string line)
    {
        if (line.Contains("Indexing", StringComparison.Ordinal)) output.Notice($"{deviceId}: {line}");
    }

    /// <summary>Records that a full index has run, so the first-run hint to index stops appearing.</summary>
    public static void MarkIndexed(ISettingsService settingsService)
    {
        var saved = settingsService.GetSettings();
        saved.HasIndexed = true;
        settingsService.SaveSettings(saved);
    }

    private sealed class NoProgress : IAsyncDisposable
    {
        public static readonly NoProgress Instance = new();

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
