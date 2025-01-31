import * as inet from '../inet';
import { ITCPServer, createServer, SOCK_STREAM, AF_INET, AF_INET6 } from '../socket';


export type BrokerInit = {
  address?: inet.SocketAddr | {
    host?: string;
    port?: number;
  };
  backlog?: number;
  maxListeners?: number;
  maxProducers?: number;
  maxConsumers?: number;
  maxMessageSize?: number;
  maxMessagesInQueue?: number;
  disconnectAfterReceivedAck?: boolean;
  defaultDeliverOptions?: {
    delay?: number;
    retry?: number | {
      backoff?: 'linear' | 'exponential';
      value: number;
    };
  };
};

export class Broker {
  readonly #srv: ITCPServer;

  public constructor(_options?: BrokerInit) {
    let addr: inet.SocketAddr = _options?.address as any;

    if(!(_options?.address instanceof inet.SocketAddr)) {
      addr = new inet.SocketAddr({
        address: _options?.address?.host,
        port: _options?.address?.port,
        family: inet.isIPv6(_options?.address?.host || '127.0.0.1') ? 'IPv6' : 'IPv4',
      });
    }

    const server = createServer(addr.type === AF_INET ? AF_INET : AF_INET6, SOCK_STREAM, addr);

    if(server.isLeft()) {
      throw server.value;
    }

    this.#srv = server.value.unwrap_expect('TCP server is missing');
  }
}

export default Broker;
