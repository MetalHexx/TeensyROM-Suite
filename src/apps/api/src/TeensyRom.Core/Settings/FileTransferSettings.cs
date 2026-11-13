namespace TeensyRom.Core.Settings
{
  /// <summary>
  /// File transfer preferences
  /// </summary>
  public record FileTransferSettings
  {
    /// <summary>Launch a file after an upload finishes. Watch folders launch by their destination's own switch instead.</summary>
    public bool AutoLaunchOnCopyEnabled { get; set; } = true;

    /// <summary>Send every file in a folder upload, not only known types.</summary>
    public bool AllFileTypesInFolders { get; set; }

    /// <summary>Send everything inside archives, not only known types.</summary>
    public bool AllFileTypesInArchives { get; set; }
  }
}
