namespace TeensyRom.Core.Settings
{
  /// <summary>
  /// One-time upgrades applied to settings written by an older version, tracked by <see cref="TeensySettings.SettingsVersion"/>.
  /// </summary>
  public static class SettingsUpgrades
  {
    public const int CurrentVersion = 1;

    /// <summary>
    /// Brings loaded settings up to <see cref="CurrentVersion"/>. Returns the same instance when nothing needs to change.
    /// </summary>
    /// <param name="loaded">Settings as read from disk.</param>
    /// <param name="changed">True when the version moved, so the result should be written back.</param>
    public static TeensySettings Apply(TeensySettings loaded, out bool changed)
    {
      changed = false;
      if (loaded.SettingsVersion >= CurrentVersion) return loaded;

      var upgraded = loaded;

      // Auto-launch used to gate watch-folder launches; now each destination decides alone.
      // Carry the old behaviour over once so folders that never launched keep not launching.
      if (loaded.SettingsVersion < 1 && !loaded.FileTransferSettings.AutoLaunchOnCopyEnabled)
      {
        upgraded = upgraded with
        {
          WatchFolders = [.. loaded.WatchFolders.Select(folder => folder with
          {
            Destinations = [.. folder.Destinations.Select(destination => destination with { Launch = false })]
          })]
        };
      }

      changed = true;
      return upgraded with { SettingsVersion = CurrentVersion };
    }
  }
}
