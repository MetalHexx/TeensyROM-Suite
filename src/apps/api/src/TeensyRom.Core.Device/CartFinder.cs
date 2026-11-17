using TeensyRom.Core.Abstractions;
using TeensyRom.Core.Common;
using TeensyRom.Core.Entities.Device;
using TeensyRom.Core.Entities.Serial;
using TeensyRom.Core.Entities.Storage;
using TeensyRom.Core.Logging;
using TeensyRom.Core.Serial;
using TeensyRom.Core.Serial.Recovery;
using TeensyRom.Core.Serial.Routines;
using TeensyRom.Core.Storage;

namespace TeensyRom.Core.Device
{
	public interface ICartFinder
	{
		/// <summary>
		/// Runs every discovery strategy, builds one device per cart (a cart seen on one serial and one TCP
		/// endpoint is built once, on the preferred transport), dedupes by chip, and ensures settings.
		/// </summary>
		Task<List<TeensyRomDevice>> FindDevices(CancellationToken ct);

		/// <summary>
		/// Same as <see cref="FindDevices(CancellationToken)"/>, except every strategy is handed
		/// <paramref name="skipEndpoints"/> so a unit already reachable elsewhere is never opened again.
		/// </summary>
		Task<List<TeensyRomDevice>> FindDevices(IReadOnlySet<string> skipEndpoints, CancellationToken ct);

		/// <summary>
		/// Turns one confirmed endpoint (from a discovery strategy or a re-confirmed cache row) into a
		/// listed device: minimal firmware rebooted through recovery, a busy storage probe reset once,
		/// Ethernet vs Serial left to the caller. Null when the endpoint cannot be listed.
		/// </summary>
		Task<TeensyRomDevice?> BuildDevice(DiscoveredEndpoint endpoint, CancellationToken ct);
	}

	public class CartFinder(
		ILoggingService log,
		IStorageFactory storageFactory,
		IDeviceInterrogator interrogator,
		IDeviceRecovery recovery,
		IEnumerable<IDiscoveryStrategy> discoveryStrategies,
		IDeviceSettingsProvider settingsProvider,
		ConnectionOptions options) : ICartFinder
	{
		private readonly IEnumerable<IDiscoveryStrategy> _discoveryStrategies = discoveryStrategies;
		private readonly IDeviceSettingsProvider _settingsProvider = settingsProvider;

		/// <summary>Reset at the top of every <see cref="FindDevicesCore"/> run; a re-confirmed cache row never needs it since only a real chip id is ever cached.</summary>
		private int _standInCount;

		public Task<List<TeensyRomDevice>> FindDevices(CancellationToken ct) => FindDevicesCore(() => DiscoverAllEndpoints(ct), ct);

		public Task<List<TeensyRomDevice>> FindDevices(IReadOnlySet<string> skipEndpoints, CancellationToken ct) =>
			FindDevicesCore(() => DiscoverAllEndpoints(skipEndpoints, ct), ct);

		private async Task<List<TeensyRomDevice>> FindDevicesCore(Func<Task<List<DiscoveredEndpoint>>> discover, CancellationToken ct)
		{
			string methodName = "CartFinder.FindDevices:";
			List<TeensyRomDevice> foundDevices = [];
			_standInCount = 0;

			try
			{
				log.Internal($"{methodName} Starting device discovery using {_discoveryStrategies.Count()} {(_discoveryStrategies.Count() == 1 ? "strategy" : "strategies")}");

				var endpoints = await discover();

				if (endpoints.Count == 0)
				{
					log.Internal($"{methodName} No endpoints discovered");
					return foundDevices;
				}

				log.Internal($"{methodName} Found {endpoints.Count} endpoint(s), validating each as TeensyROM device");

				foreach (var candidates in GroupEndpointsByCart(endpoints))
				{
					ct.ThrowIfCancellationRequested();

					var device = await BuildFirstListable(candidates, ct);
					if (device != null)
					{
						foundDevices.Add(device);
					}
				}
				log.InternalSuccess($"{methodName} Discovery complete. Found {foundDevices.Count} TeensyROM device(s)");
				foundDevices = DeduplicateByDeviceId(foundDevices);

				foreach (var device in foundDevices)
				{
					if (device.Cart?.DeviceId is not null && device.Cart.IsCompatible)
					{
						EnsureDeviceInSettings(device.Cart.DeviceId);
					}
				}
			}
			catch (OperationCanceledException)
			{
				foreach (var device in foundDevices)
				{
					device.CommunicationPort.Dispose();
				}
				throw;
			}
			return foundDevices;
		}

		/// <summary>
		/// Runs the discovery strategies and merges the results. They run one after the other, not in
		/// parallel: the serial strategy finishes before it returns, so the TCP sweep starts after it.
		/// </summary>
		private async Task<List<DiscoveredEndpoint>> DiscoverAllEndpoints(CancellationToken ct)
		{
			if (!_discoveryStrategies.Any())
			{
				log.Internal("CartFinder.DiscoverAllEndpoints: No discovery strategies registered");
				return [];
			}
			var tasks = _discoveryStrategies.Select(s => s.FindEndpoints(ct));
			var results = await Task.WhenAll(tasks);
			var allEndpoints = results.SelectMany(r => r).ToList();

			log.Internal($"CartFinder.DiscoverAllEndpoints: Discovered {allEndpoints.Count} endpoint(s) across {_discoveryStrategies.Count()} strategy(ies)");

			return allEndpoints;
		}

		/// <summary>Same as <see cref="DiscoverAllEndpoints(CancellationToken)"/>, passing the skip set to every strategy.</summary>
		private async Task<List<DiscoveredEndpoint>> DiscoverAllEndpoints(IReadOnlySet<string> skipEndpoints, CancellationToken ct)
		{
			if (!_discoveryStrategies.Any())
			{
				log.Internal("CartFinder.DiscoverAllEndpoints: No discovery strategies registered");
				return [];
			}
			var tasks = _discoveryStrategies.Select(s => s.FindEndpoints(skipEndpoints, ct));
			var results = await Task.WhenAll(tasks);
			var allEndpoints = results.SelectMany(r => r).ToList();

			log.Internal($"CartFinder.DiscoverAllEndpoints: Discovered {allEndpoints.Count} endpoint(s) across {_discoveryStrategies.Count()} strategy(ies)");

			return allEndpoints;
		}

		/// <summary>
		/// Groups the endpoints into one list per device to build. A cart whose version reply names the same
		/// chip on exactly one Serial and one TCP endpoint, both in full firmware, is one group with the
		/// preferred transport first, so its storage is probed once: storage belongs to the cart, not the
		/// connection, and the version reply has already confirmed the other address. Every other endpoint
		/// is a group of its own and is built as before, with <see cref="DeduplicateByDeviceId"/> merging
		/// anything that turns out to be the same chip afterwards.
		/// </summary>
		private List<List<DiscoveredEndpoint>> GroupEndpointsByCart(List<DiscoveredEndpoint> endpoints)
		{
			var pairs = endpoints
				.Where(e => e.Version.ChipId is not null && !e.Version.IsMinimalFirmware)
				.GroupBy(e => e.Version.ChipId!)
				.Where(g => g.Count() == 2
					&& g.Any(e => e.ConnectionType == ConnectionType.Serial)
					&& g.Any(e => e.ConnectionType == ConnectionType.Tcp))
				.ToDictionary(g => g.Key, g => g.OrderBy(e => e.ConnectionType == options.PreferredTransport ? 0 : 1).ToList());

			var groups = new List<List<DiscoveredEndpoint>>();
			var grouped = new HashSet<string>();

			foreach (var endpoint in endpoints)
			{
				if (endpoint.Version.ChipId is { } chipId
					&& pairs.TryGetValue(chipId, out var pair)
					&& pair.Any(e => ReferenceEquals(e, endpoint)))
				{
					if (grouped.Add(chipId))
					{
						groups.Add(pair);
					}

					continue;
				}

				groups.Add([endpoint]);
			}

			return groups;
		}

		/// <summary>
		/// Builds the first endpoint in <paramref name="candidates"/> that lists. The ones after it are the
		/// same cart on its other transport: their ports are closed and their addresses written onto the
		/// device's record without probing storage again. When an endpoint of a pair does not list, its port
		/// is closed and the next is tried; a lone endpoint that does not list is left as before.
		/// </summary>
		private async Task<TeensyRomDevice?> BuildFirstListable(List<DiscoveredEndpoint> candidates, CancellationToken ct)
		{
			for (var i = 0; i < candidates.Count; i++)
			{
				var device = await BuildDevice(candidates[i], ct);

				if (device is null)
				{
					// The same cart is still reachable on its other transport: close this one so its port
					// (on TCP, the device's single client connection) is not held while that one is tried.
					if (candidates.Count > 1)
					{
						candidates[i].CommunicationPort.Dispose();
					}

					continue;
				}

				foreach (var other in candidates.Skip(i + 1))
				{
					log.Internal($"CartFinder.FindDevices: Device {device.DeviceId} found on {candidates.Count} transport(s), keeping {device.ConnectionType}; {other.Display} recorded without probing storage again");
					other.CommunicationPort.Dispose();
					RecordOtherEndpoint(device, other.ConnectionType, other.Display);
				}

				return device;
			}

			return null;
		}

		/// <summary>
		/// Writes the same cart's endpoint on another transport onto <paramref name="preferred"/>'s record as
		/// a known address. The record is not confirmed again, so everything building the device left there
		/// stays as it is: the preferred transport in use, a busy mode, and a pending menu boot after a reset.
		/// </summary>
		private static void RecordOtherEndpoint(TeensyRomDevice preferred, ConnectionType otherType, string otherEndpoint) =>
			preferred.Connection.RememberEndpoint(otherType, otherEndpoint);

		/// <summary>
		/// Builds a device from one confirmed endpoint. Identity and hardware facts come from the
		/// endpoint's version reply; storage availability comes from a read-only root probe of each
		/// storage type. Minimal firmware is reset and carried through recovery before being listed;
		/// a busy storage probe is reset and re-probed once.
		/// </summary>
		public async Task<TeensyRomDevice?> BuildDevice(DiscoveredEndpoint endpoint, CancellationToken ct)
		{
			string methodName = $"CartFinder.BuildDevice({endpoint.Display}):";
			var port = endpoint.CommunicationPort;
			var reply = endpoint.Version;

			try
			{
				var cart = new Cart();
				VersionReplyMapper.Apply(reply, cart);

				cart.DeviceId ??= NextStandInDeviceId();
				cart.SdStorage.DeviceId = cart.DeviceId;
				cart.UsbStorage.DeviceId = cart.DeviceId;

				var connection = new DeviceConnectionRecord(cart.DeviceId);
				var device = new TeensyRomDevice(
					cart,
					port,
					storageFactory.Create(cart.SdStorage, port),
					storageFactory.Create(cart.UsbStorage, port),
					connection);

				device.Confirm(endpoint.ConnectionType, endpoint.Display, reply.IsMinimalFirmware ? DeviceMode.Minimal : DeviceMode.FullIdle);

				if (reply.IsMinimalFirmware)
				{
					log.Internal($"{methodName} device is in minimal firmware; resetting and waiting for it to leave");
					port.ResetFromMinimal(log);
					var outcome = await recovery.RecoverAsync(device, RecoveryReason.LeaveMinimal, ct);

					if (outcome.Mode is not (DeviceMode.FullIdle or DeviceMode.FullBusy))
					{
						log.InternalWarning($"{methodName} device did not leave minimal firmware ({outcome.Mode}); not listed");
						return null;
					}

					return device;
				}

				if (!cart.IsCompatible)
				{
					ReportIncompatibleFirmware(reply);
					return device;
				}

				var sd = interrogator.ProbeStorage(port, TeensyStorageType.SD);
				var usb = interrogator.ProbeStorage(port, TeensyStorageType.USB);

				if (sd == StoragePresence.Busy || usb == StoragePresence.Busy)
				{
					log.Internal($"{methodName} storage busy (SD {sd}, USB {usb}); resetting and re-probing once");

					if (port.ResetDevice(log, options.MenuBootTimeoutMs) == MenuBootOutcome.StillBooting)
					{
						device.MarkMenuBootPending();
					}

					sd = interrogator.ProbeStorage(port, TeensyStorageType.SD);
					usb = interrogator.ProbeStorage(port, TeensyStorageType.USB);

					if (sd == StoragePresence.Busy || usb == StoragePresence.Busy)
					{
						log.InternalWarning($"{methodName} storage still busy after reset; listing as busy with storage unknown");
						device.MarkBusy();
						return device;
					}
				}

				// Unknown is "could not tell", not "missing" - the probe's own log line says why. Listing the
				// storage keeps a slow or confused reply from hiding an SD card the user can see; a storage
				// that is really missing is reported by its own commands.
				cart.SdStorage.Available = sd != StoragePresence.Absent;
				cart.UsbStorage.Available = usb != StoragePresence.Absent;

				log.Internal($"{methodName} SD probe {sd}, USB probe {usb}");
				log.InternalSuccess($"{methodName} {reply.HardwareVariant} fw {cart.FwVersion} chip {cart.DeviceId} on {reply.Machine} {reply.VideoStandard} {reply.TodClockHz?.ToString() ?? "unknown"} Hz");

				return device;
			}
			catch (Exception ex)
			{
				log.ExternalError($"{methodName} Error creating device: {ex.Message}");
				return null;
			}
		}

		/// <summary>True when the reply carried no chip id: assigns the next per-run stand-in ("Unknown", "Unknown-2", ...).</summary>
		private string NextStandInDeviceId()
		{
			_standInCount++;
			return StandInDeviceId.ForOrdinal(_standInCount);
		}

		/// <summary>
		/// Writes the log trail for a device whose firmware is below the
		/// supported floor. The device is still created and listed so the UI can report it.
		/// </summary>
		private void ReportIncompatibleFirmware(VersionReply reply)
		{
			log.InternalError($"TeensyROM firmware check failed. v{VersionReplyParser.FullFirmwareFloor}+ is required.");

			if (reply.FirmwareVersion is null)
			{
				log.InternalError("Unable to determine the version of TeensyROM.");
			}
			else
			{
				log.InternalError($"v{reply.FirmwareVersion} is not supported by this app and may lead to unexpected results.");
			}
			log.InternalError("FW Download: https://github.com/SensoriumEmbedded/TeensyROM/tree/main/bin/TeensyROM");
			log.InternalError("FW Instructions: https://github.com/SensoriumEmbedded/TeensyROM/blob/main/docs/General_Usage.md#firmware-updates");
		}

		/// <summary>
		/// Ensures a discovered device is saved to settings.
		/// Skips devices without a chip id (no stable DeviceId to key on).
		/// </summary>
		private void EnsureDeviceInSettings(string deviceId)
		{
			if (string.IsNullOrWhiteSpace(deviceId) || StandInDeviceId.IsStandIn(deviceId))
			{
				log.Internal($"CartFinder.EnsureDeviceInSettings: Skipping unidentified device {deviceId}");
				return;
			}

			try
			{
				_settingsProvider.GetOrCreateDeviceSettings(deviceId);
				log.Internal($"CartFinder.EnsureDeviceInSettings: Ensured device {deviceId} exists in settings");
			}
			catch (Exception ex)
			{
				log.InternalError($"CartFinder.EnsureDeviceInSettings: Failed to save device {deviceId}: {ex.Message}");
			}
		}

		/// <summary>
		/// Deduplicates devices that were built separately but turn out to be the same chip - the endpoints
		/// <see cref="GroupEndpointsByCart"/> leaves to build on their own, such as a cart in minimal firmware
		/// on one transport. <see cref="ConnectionOptions.PreferredTransport"/> wins: the other port is
		/// disposed and its endpoint is recorded on the surviving device's record by
		/// <see cref="RecordOtherEndpoint"/>, so the one record carries both endpoints while
		/// <c>TransportInUse</c> stays the preferred transport.
		/// </summary>
		private List<TeensyRomDevice> DeduplicateByDeviceId(List<TeensyRomDevice> devices)
		{
			var grouped = devices.GroupBy(d => d.Cart.DeviceId);
			var result = new List<TeensyRomDevice>();

			foreach (var group in grouped)
			{
				if (group.Count() == 1)
				{
					// Only one transport found - use it
					result.Add(group.First());
					continue;
				}

				// Multiple transports for same device - keep the preferred one
				var match = group.FirstOrDefault(d => d.ConnectionType == options.PreferredTransport);
				var preferred = match ?? group.First();

				result.Add(preferred);

				log.Internal($"CartFinder.DeduplicateByDeviceId: Device {group.Key} found on {group.Count()} transport(s), keeping {preferred.ConnectionType}");

				// Dispose non-preferred transports
				foreach (var device in group.Where(d => d != preferred))
				{
					if (match is not null && device.ConnectionType != preferred.ConnectionType && device.Connection.EndpointFor(device.ConnectionType) is { } otherEndpoint)
					{
						RecordOtherEndpoint(preferred, device.ConnectionType, otherEndpoint);
					}

					log.Internal($"CartFinder.DeduplicateByDeviceId: Disposing duplicate {device.ConnectionType} connection for {device.Cart.DeviceId}");
					device.CommunicationPort.Dispose();
				}
			}

			return result;
		}
	}
}
