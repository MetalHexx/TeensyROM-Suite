namespace TeensyRom.Cli.Services;

/// <summary>The engine's upload settings: what happens to files as they land on the TeensyROM.</summary>
/// <param name="AutoLaunch">Whether an upload launches one file once it lands.</param>
/// <param name="AllTypes">Whether a folder upload sends every file, not only the types the TeensyROM recognizes.</param>
/// <param name="AllInArchives">Whether an archive's contents are all kept, not only the types the TeensyROM recognizes.</param>
internal sealed record UploadSettings(bool AutoLaunch, bool AllTypes, bool AllInArchives);

/// <summary>Reads and changes the engine's upload settings.</summary>
/// <remarks>Every failure arrives as a <see cref="Api.TeensyApiException"/> carrying the engine's own wording.</remarks>
internal interface ITransferSettingsService
{
    Task<UploadSettings> GetAsync(CancellationToken ct);

    /// <summary>Changes the given settings and returns all of them as they are now; a null leaves its setting as it is.</summary>
    Task<UploadSettings> SetAsync(bool? autoLaunch, bool? allTypes, bool? allInArchives, CancellationToken ct);
}
