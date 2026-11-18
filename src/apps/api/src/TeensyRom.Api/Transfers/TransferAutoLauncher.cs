using TeensyRom.Api.Services;
using TeensyRom.Core.Entities.Transfers;
using TeensyRom.Core.Logging;
using TeensyRom.Core.Settings;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Api.Transfers
{
    /// <summary>
    /// Launch-after-transfer policy and execution. A watch-folder job launches exactly when its destination's own
    /// launch switch asked for it, whatever the auto-launch setting; any other job when the auto-launch setting
    /// or its own request says so.
    /// </summary>
    public sealed class TransferAutoLauncher(
        ISettingsService settings,
        IFileLaunchService launcher,
        ITransferProgressNotifier notifier,
        ILoggingService log) : ITransferAutoLauncher
    {
        public bool ShouldLaunch(TransferJob job)
        {
            return job.Origin.Kind is TransferOriginKind.WatchFolder
                ? job.LaunchRequested
                : settings.GetSettings().FileTransferSettings.AutoLaunchOnCopyEnabled || job.LaunchRequested;
        }

        public void StartLaunch(TransferJob job)
        {
            var snapshot = job.ToSnapshot();

            if (snapshot.LaunchState is not TransferLaunchState.Pending || snapshot.LaunchedPath is null)
            {
                return;
            }

            var path = snapshot.LaunchedPath;

            _ = Task.Run(() => RunLaunchAsync(job, path));
        }

        /// <summary>
        /// Every path out of here ends with <see cref="TransferJob.CompleteLaunch"/> and a notification:
        /// a job left Pending would hang any client polling for the launch outcome.
        /// </summary>
        private async Task RunLaunchAsync(TransferJob job, string path)
        {
            var state = TransferLaunchState.Failed;
            string? error = null;

            try
            {
                var outcome = await launcher.LaunchAsync(job.DeviceId, job.StorageType, new FilePath(path), CancellationToken.None);

                switch (outcome.Status)
                {
                    case FileLaunchStatus.Launched:
                        state = TransferLaunchState.Launched;
                        break;
                    case FileLaunchStatus.Incompatible:
                        state = TransferLaunchState.Incompatible;
                        break;
                    default:
                        error = outcome.Message;
                        break;
                }
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }

            if (error is not null)
            {
                Warn($"Launch after transfer failed for '{path}': {error}", job.DeviceId);
            }

            job.CompleteLaunch(state, error);

            try
            {
                notifier.JobChanged(job);
            }
            catch (Exception ex)
            {
                Warn($"Notifying the launch result failed for '{path}': {ex.Message}", job.DeviceId);
            }
        }

        private void Warn(string message, string deviceId)
        {
            try
            {
                log.InternalWarning(message, deviceId);
            }
            catch
            {
                // A failing logger must not keep the job Pending.
            }
        }
    }
}
