import * as tls from 'node:tls';

import * as inet from '../inet';


export type ConsumerInit = {
  address?: inet.SocketAddr | {
    host?: string;
    port?: number;
  };
  tls?: tls.SecureContextOptions & tls.TlsOptions;
  maxHeaderSize?: number;
  highWaterMark?: number;
  keepAliveTimeout?: number;
};

export class Consumer {
  public constructor(_options?: ConsumerInit) {
    void _options;
  }
}
