
using System.Reactive;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Settings;
using TeensyRom.Core.ValueObjects;

namespace TeensyRom.Core.Storage
{
    public interface IStorageCache
    {
        IObservable<Unit> StorageReady { get; }
        void DeleteDirectory(DirectoryPath path);
        void DeleteDirectoryWithChildren(DirectoryPath path);
        void DeleteFile(FilePath path);

        /// <summary>
        /// Creates the entry for <paramref name="path"/> and for every ancestor the index does not hold, linking
        /// each new one into its parent's subfolder list. Returns the entries it created, outermost first; an
        /// empty list means the folder was already held.
        /// </summary>
        IReadOnlyList<DirectoryPath> EnsureParents(DirectoryPath path);

        /// <summary>
        /// Lists <paramref name="path"/> among its parent's subfolders when the parent entry exists. Never
        /// creates an entry, and does nothing for the root or a folder already listed.
        /// </summary>
        void LinkToParent(DirectoryPath path);

        IStorageCacheItem? GetByDirPath(DirectoryPath path);
        List<FileItem> GetFileByName(string name);
        FileItem? GetFileByPath(FilePath filePath);
        void UpsertDirectory(DirectoryPath path, IStorageCacheItem directory);
        void UpsertFile(FileItem fileItem);
        void Clear();
        void EnsureFavorites();
        IEnumerable<LaunchableItem> Search(string searchText, IEnumerable<DirectoryPath> excludePaths, params TeensyFileType[] fileTypes);
        LaunchableItem? GetRandomFile(StorageScope scope, DirectoryPath scopePath, IEnumerable<DirectoryPath> excludePaths, params TeensyFileType[] fileTypes);
        void WriteToDisk();
        void ClearCache();
        int GetCacheSize();
        void EnsurePlaylists();
        List<LaunchableItem> GetFavoriteFiles();
        List<LaunchableItem> GetPlaylistFiles();
        FileItem? FindParentFile(FileItem item);
        List<FileItem> FindSiblings(FileItem item);
    }
}
