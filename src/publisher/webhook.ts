import * as inet from '../inet';
import { BufferReader } from '../protocol';
import Exception from '../@internals/errors';
import { createMessage, MessageInit } from '../messages';


export type PublisherOptions = {
  timeout?: number;
  useFetch?: boolean;
};

export function publishWebhookMessage(address: inet.SocketAddr, message: Buffer, options?: PublisherOptions): Promise<void>;
export function publishWebhookMessage<T>(address: inet.SocketAddr, init: MessageInit<T>, options?: PublisherOptions): Promise<void>;
export async function publishWebhookMessage(address: inet.SocketAddr, messageOrInit: Buffer | MessageInit<unknown>, options?: PublisherOptions): Promise<void> {
  const url = new URL('/webhook', `http://${address.address}:${address.port}`);

  const buffer = Buffer.isBuffer(messageOrInit) ?
    messageOrInit :
    await createMessage(messageOrInit);
  
  if(typeof process === 'undefined' || options?.useFetch) {
    const res = await Promise.race([
      fetch(url, {
        method: 'POST',
        keepalive: false,
        body: new Blob([ buffer ]),
      }),

      options?.timeout && typeof options.timeout === 'number' ? new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Exception('Timeout limit reached while trying to establish server connection', 'ERR_TIMEOUT'));
        }, options.timeout);
      }) : void 0,
    ].filter(item => !!item)) as Response;

    if(res.status !== 202) {
      throw new Exception(`The server was rejected the message with code 0x${res.status.toString(16).toUpperCase()}`, 'ERR_UNKNOWN_ERROR');
    }

    return;
  }

  const { request } = await import('node:http');
  const reader = new BufferReader(buffer);

  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', timeout: options?.timeout }, res => {
      res.on('error', reject);
      
      res.on('end', () => {
        if(res.statusCode === 202)
          return resolve();

        reject(new Exception(`The server was rejected the message with code 0x${res.statusCode?.toString(16).toUpperCase()}`, 'ERR_UNKNOWN_ERROR'));
      });

      res.on('data', () => void 0);
    });

    for(let i = 0; i < reader.byteLength; i += 1024 * 3) {
      req.write(reader.read(1024 * 3));
    }

    req.on('error', reject);
    req.end();
  });
}
