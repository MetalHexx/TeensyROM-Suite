using System.Collections.Concurrent;
using System.Reactive;
using System.Text;
using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Entities.Serial;
using TeensyRom.Core.Serial;

namespace TeensyRom.Api.Tests.Integration.Common
{
    /// <summary>
    /// One file received by a <see cref="FakeCommunicationPort"/>, as declared by the sender's
    /// handshake and the body bytes actually written.
    /// </summary>
    public sealed record FakeReceivedFile(string Path, uint StorageToken, uint DeclaredLength, ushort DeclaredChecksum, byte[] Body);

    /// <summary>
    /// A hardware-free <see cref="ICommunicationPort"/> that speaks just enough of the wire protocol to
    /// satisfy the SendFile / DeleteFile handshake, recording every file it "receives" for test
    /// assertions. It also plays a healthy device through a reset - the menu's boot token, then a version
    /// reply reporting the boot complete - and counts the resets it was sent (<see cref="ResetCount"/>).
    /// </summary>
    public sealed class FakeCommunicationPort : ICommunicationPort
    {
        private enum Stage
        {
            AwaitToken, AwaitLength, AwaitChecksum, AwaitStorageToken, AwaitPath, AwaitBody, AwaitDeleteStorageToken, AwaitDeletePath,
            AwaitListStorageToken, AwaitListSkip, AwaitListTake, AwaitListPath
        }

        private readonly object _gate = new();
        private readonly ConcurrentQueue<FakeReceivedFile> _received = new();
        private readonly ConcurrentQueue<string> _directoryReads = new();

        private Stage _stage = Stage.AwaitToken;
        private uint _pendingLength;
        private ushort _pendingChecksum;
        private uint _pendingStorageToken;
        private string? _pendingPath;
        private List<byte> _pendingBody = [];
        private ushort _nextTwoByteResponse = TeensyToken.Ack.Value;

        /// <summary>
        /// True from the moment a command response is queued until <see cref="Read(byte[], int, int)"/>
        /// delivers it - the seam <see cref="BytesToRead"/> reads to report "no more data" once that one
        /// reply has been consumed, the same as a real port going idle. Without it, a caller polling for
        /// idle (<c>TRDiscoveryRoutines.ReadTextUntilIdle</c>) sees a permanently nonzero backlog and
        /// spins for its full timeout on every call instead of returning as soon as the reply is read.
        /// </summary>
        private bool _hasUnreadResponse;

        private readonly Queue<byte> _replyText = new();
        private int _resetCount;

        /// <summary>Applied while a file body is being written - the knob the concurrency proof turns.</summary>
        public TimeSpan PerFileDelay { get; set; } = TimeSpan.Zero;

        /// <summary>When set, invoked with the target path of an incoming SendFile write; a non-null result is thrown.</summary>
        public Func<string, Exception?>? FailFor { get; set; }

        /// <summary>
        /// When true, every command the device would otherwise acknowledge fails as if the device
        /// vanished mid-command - <see cref="IsOpen"/> reports closed from that point on too, the same
        /// as a real transport drop, since callers (the command pipeline's gate, <c>TransferFilesCommandHandler</c>)
        /// key their own "device is gone" branch off it rather than the exception alone.
        /// </summary>
        public bool SimulateDeviceLoss { get; set; }

        public IReadOnlyList<FakeReceivedFile> Received => [.. _received];

        /// <summary>Every folder the device was asked to list, in the order asked.</summary>
        public IReadOnlyList<string> DirectoryReads => [.. _directoryReads];

        /// <summary>How many reset tokens the device has been sent, whoever sent them - the pump or the command gate.</summary>
        public int ResetCount
        {
            get
            {
                lock (_gate)
                {
                    return _resetCount;
                }
            }
        }

        public bool IsOpen => !SimulateDeviceLoss;

        public int BytesToRead
        {
            get
            {
                lock (_gate)
                {
                    return _hasUnreadResponse ? 2 : _replyText.Count;
                }
            }
        }

        public void ClearBuffers() { }

        public void SendIntBytes(uint intToSend, short numBytes)
        {
            if (SimulateDeviceLoss)
            {
                throw new IOException("Fake device connection lost.");
            }

            lock (_gate)
            {
                if (numBytes == 2 && intToSend == TeensyToken.FwCheckToken.Value)
                {
                    _nextTwoByteResponse = TeensyToken.FWFullToken.Value;
                    _hasUnreadResponse = true;
                    return;
                }
                if (numBytes == 2 && intToSend == TeensyToken.Ping.Value)
                {
                    return;
                }
                if (numBytes == 2 && intToSend == TeensyToken.Reset.Value)
                {
                    _resetCount++;
                    _nextTwoByteResponse = TeensyToken.GoodSIDToken.Value;
                    _hasUnreadResponse = true;
                    return;
                }
                if (numBytes == 2 && intToSend == TeensyToken.VersionInfo.Value)
                {
                    _nextTwoByteResponse = TeensyToken.Ack.Value;
                    _hasUnreadResponse = true;

                    foreach (var textByte in Encoding.Latin1.GetBytes("Boot: complete\r\n"))
                    {
                        _replyText.Enqueue(textByte);
                    }

                    return;
                }
                if (numBytes == 2 && intToSend == TeensyToken.SendFile.Value)
                {
                    _stage = Stage.AwaitLength;
                    _nextTwoByteResponse = TeensyToken.Ack.Value;
                    _hasUnreadResponse = true;
                    return;
                }
                if (numBytes == 2 && intToSend == TeensyToken.DeleteFile.Value)
                {
                    _stage = Stage.AwaitDeleteStorageToken;
                    _nextTwoByteResponse = TeensyToken.Ack.Value;
                    _hasUnreadResponse = true;
                    return;
                }
                if (numBytes == 2 && intToSend == TeensyToken.ListDirectory.Value)
                {
                    _stage = Stage.AwaitListStorageToken;
                    _nextTwoByteResponse = TeensyToken.Ack.Value;
                    _hasUnreadResponse = true;
                    return;
                }

                switch (_stage)
                {
                    case Stage.AwaitListStorageToken:
                        _stage = Stage.AwaitListSkip;
                        break;
                    case Stage.AwaitListSkip:
                        _stage = Stage.AwaitListTake;
                        break;
                    case Stage.AwaitListTake:
                        _stage = Stage.AwaitListPath;
                        break;
                    case Stage.AwaitLength:
                        _pendingLength = intToSend;
                        _stage = Stage.AwaitChecksum;
                        break;
                    case Stage.AwaitChecksum:
                        _pendingChecksum = (ushort)intToSend;
                        _stage = Stage.AwaitStorageToken;
                        break;
                    case Stage.AwaitStorageToken:
                        _pendingStorageToken = intToSend;
                        _stage = Stage.AwaitPath;
                        break;
                    case Stage.AwaitDeleteStorageToken:
                        _stage = Stage.AwaitDeletePath;
                        break;
                }
                _nextTwoByteResponse = TeensyToken.Ack.Value;
                _hasUnreadResponse = true;
            }
        }

        public void Write(string text)
        {
            lock (_gate)
            {
                var path = text.TrimEnd('\0');

                if (_stage == Stage.AwaitPath)
                {
                    if (FailFor?.Invoke(path) is Exception ex)
                    {
                        _stage = Stage.AwaitToken;
                        throw ex;
                    }
                    _pendingPath = path;
                    _pendingBody = [];
                    _stage = Stage.AwaitBody;
                }
                else if (_stage == Stage.AwaitDeletePath)
                {
                    _stage = Stage.AwaitToken;
                }
                else if (_stage == Stage.AwaitListPath)
                {
                    EnqueueDirectoryListing(path);
                    _nextTwoByteResponse = TeensyToken.Ack.Value;
                    _hasUnreadResponse = true;
                    _stage = Stage.AwaitToken;
                }
            }
        }

        /// <summary>
        /// Queues the device's reply to a non-recursive directory read: the start token, one JSON line for each
        /// file sent into <paramref name="folder"/> and for each folder holding something sent below it, then the
        /// end token. The caller holds <see cref="_gate"/>.
        /// </summary>
        private void EnqueueDirectoryListing(string folder)
        {
            _directoryReads.Enqueue(folder);

            var files = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            var subfolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var received in _received)
            {
                if (!received.Path.StartsWith(folder, StringComparison.OrdinalIgnoreCase)) continue;

                var relative = received.Path[folder.Length..];
                var slash = relative.IndexOf('/');

                if (slash < 0)
                {
                    files[relative] = received.DeclaredLength;
                }
                else
                {
                    subfolders.Add(relative[..slash]);
                }
            }

            var lines = subfolders.Select(name => $"{{\"type\":\"dir\",\"name\":\"{name}\"}}\r\n")
                .Concat(files.Select(file => $"{{\"type\":\"file\",\"name\":\"{file.Key}\",\"size\":{file.Value}}}\r\n"));

            foreach (var textByte in new byte[] { 0x5A, 0x5A }
                .Concat(Encoding.UTF8.GetBytes(string.Concat(lines)))
                .Concat(new byte[] { 0xA5, 0xA5 }))
            {
                _replyText.Enqueue(textByte);
            }
        }

        public void Write(byte[] buffer, int offset, int count)
        {
            List<byte>? completedBody = null;
            uint length = 0, storageToken = 0;
            ushort checksum = 0;
            string? path = null;

            lock (_gate)
            {
                if (_stage != Stage.AwaitBody) return;

                _pendingBody.AddRange(buffer.Skip(offset).Take(count));

                if (_pendingBody.Count >= _pendingLength)
                {
                    completedBody = _pendingBody;
                    length = _pendingLength;
                    storageToken = _pendingStorageToken;
                    checksum = _pendingChecksum;
                    path = _pendingPath;
                    _stage = Stage.AwaitToken;
                }
            }

            if (completedBody is null || path is null) return;

            if (PerFileDelay > TimeSpan.Zero)
            {
                Thread.Sleep(PerFileDelay);
            }

            _received.Enqueue(new FakeReceivedFile(path, storageToken, length, checksum, [.. completedBody]));
        }

        public void Write(char[] buffer, int offset, int count) { }

        public uint ReadIntBytes(short byteLength) => 0;

        public int Read(byte[] buffer, int offset, int count)
        {
            ushort response;
            lock (_gate)
            {
                if (!_hasUnreadResponse && _replyText.Count > 0)
                {
                    var taken = 0;

                    while (taken < count && _replyText.Count > 0)
                    {
                        buffer[offset + taken++] = _replyText.Dequeue();
                    }

                    return taken;
                }

                response = _nextTwoByteResponse;
                _hasUnreadResponse = false;
            }
            var bytes = BitConverter.GetBytes(response);
            var toCopy = Math.Min(count, bytes.Length);
            Array.Copy(bytes, 0, buffer, offset, toCopy);
            return toCopy;
        }

        public int ReadByte() => -1;
        public string ReadSerialAsString(int msToWait = 0) => string.Empty;
        public string ReadAndLogSerialAsString(int msToWait = 0) => string.Empty;
        public byte[] ReadSerialBytes() => [];
        public byte[] ReadSerialBytes(int msToWait = 0) => [];
        public void WaitForSerialData(int numBytes, int timeoutMs) { }
        public void SendSignedChar(sbyte charToSend) { }
        public void SendSignedShort(short value) { }
        public string? OpenPort(bool useRetryLoop = true) => "FAKE0";
        public Unit ClosePort() => Unit.Default;
        public Unit SetPort(string port) => Unit.Default;
        public string GetEndpoint() => "FAKE0";

        public ConnectionType GetConnectionType() => ConnectionType.Tcp;

        public void Dispose() { }
    }
}
