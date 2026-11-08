import {
  ASID_SENDER_IDENTITY,
  isConnectMessage,
  pairedLocalOrigin,
} from '@teensyrom-nx/asid-sender-protocol';

export interface ConnectPage {
  readonly parent: unknown;
  readonly location: {
    readonly protocol: string;
    readonly hostname: string;
    readonly port: string;
  };
}

export interface ConnectEvent<P> {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
  readonly ports: readonly P[];
}

/**
 * Accepts the first `connect` message that comes from this page's parent, from the app's other
 * local name, with the sender's identity and a port. Every other message is ignored without an
 * answer, and once one connect is accepted no other ever is.
 */
export class ConnectGuard {
  private accepted = false;

  constructor(private readonly page: ConnectPage) {}

  /** The channel's port when `event` is the accepted connect; otherwise null. */
  accept<P>(event: ConnectEvent<P>): P | null {
    if (this.accepted) {
      return null;
    }
    const expectedOrigin = pairedLocalOrigin(this.page.location);
    if (
      expectedOrigin === null ||
      event.origin !== expectedOrigin ||
      event.source !== this.page.parent ||
      !isConnectMessage(event.data) ||
      event.data.identity !== ASID_SENDER_IDENTITY
    ) {
      return null;
    }
    const port = event.ports[0];
    if (port === undefined) {
      return null;
    }
    this.accepted = true;
    return port;
  }
}
