using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Settings;
using TeensyRom.Core.Storage;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Core.Abstractions
{
    public interface IStorageService
    {
        Task<bool> CacheAll(CancellationToken ct);
        Task<bool> Cache(DirectoryPath path, CancellationToken ct);
        public void ClearCache();
        public void ClearCache(DirectoryPath path);
        public Task<FileItem?> GetFile(FilePath filePath);

        /// <summary>Looks a file up, telling a missing file apart from a failed read of its parent directory.</summary>
        Task<FileLookupResult> LookupFile(FilePath filePath);

        /// <summary>Reads a file's raw bytes from this storage over the serial link. Never cached.</summary>
        Task<FileBytesResult> ReadFileBytes(FilePath filePath, CancellationToken ct);
        Task<IStorageCacheItem?> GetDirectory(DirectoryPath directoryPath);

        /// <summary>Reads a directory, telling a missing directory apart from a failed read.</summary>
        Task<DirectoryReadResult> ReadDirectory(DirectoryPath directoryPath);
        LaunchableItem? GetRandomFile(StorageScope scope, DirectoryPath scopePath, TeensyFilterType filterType);
        IEnumerable<LaunchableItem> Search(string searchText, TeensyFilterType filterType = TeensyFilterType.All);
        Task<LaunchableItem?> SaveFavorite(LaunchableItem launchItem, TeensyStorageType storageType, CancellationToken ct);
        Task<bool> RemoveFavorite(LaunchableItem file, TeensyStorageType storageType, CancellationToken ct);

        /// <summary>
        /// Deletes one file from the device and drops it from the cache. Folders are refused, judged from the
        /// cached parent listing (banned subfolders included), and nothing is sent to the device.
        /// A missing or banned parent folder reads as <see cref="FileDeleteOutcome.NotFound"/>, so a file inside
        /// a banned folder answers not found until the folder is unbanned.
        /// </summary>
        Task<FileDeleteResult> DeleteFile(FilePath path, CancellationToken ct);

        /// <summary>
        /// Upserts a single freshly-transferred file into the in-memory cache so it is queryable
        /// immediately, without re-indexing. Does not persist to disk - see <see cref="PersistCache"/>.
        /// </summary>
        void UpsertTransferredFile(FilePath targetPath, long sizeBytes);

        /// <summary>Writes the current cache state to disk. Call once per terminal job, not per file.</summary>
        void PersistCache();
    }
}
