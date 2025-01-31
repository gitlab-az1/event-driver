import * as http from 'node:http';
import { IDisposable } from '@rapid-d-kit/disposable';
import { assertUnsignedInteger } from '@rapid-d-kit/safe';
import type { BufferLike, LooseAutocomplete } from '@rapid-d-kit/types';
import { chunkToBuffer, exclude, unmask as unmaskBuffer } from '@ts-overflow/node.std';

import * as inet from './inet';
import { IEvent } from './events';
import * as protocol from './protocol';
import { EventEmitter } from './emitter';
import Exception from './@internals/errors';
import { ParsedMessage, parseMessage } from './messages';


const $handler = Symbol('kServerHandler');
const $addr = Symbol('kAddressHandler');


export interface WebhookServerDefaultEventsMap {
  close: never;
  dispose: never;
  listening: never;
  'raw-message': Buffer;
  message: ParsedMessage<unknown>;
  error: Exception;
}

type ServerState = {
  paused: boolean;
  closed: boolean;
  disposed: boolean;
  listening: boolean;
};


export type WebhookServerInit = {
  address?: inet.SocketAddr | {
    host?: string;
    port?: number;
  };
  mask?: Uint8Array;
  backlog?: number;
  maxMessageSize?: number;
  connectionTimeout?: number;
  lazy?: boolean;
  sec?: {
    encryptionKey?: BufferLike;
    salt?: BufferLike;
  };
};

export class WebhookServer extends EventEmitter implements IDisposable {
  readonly #options?: Omit<WebhookServerInit, 'address'>;
  readonly #state: ServerState;

  readonly [$addr]: inet.SocketAddr;
  readonly [$handler]: http.Server;

  public constructor(_options?: WebhookServerInit) {
    let addr: inet.SocketAddr = _options?.address as any;

    if(!(_options?.address instanceof inet.SocketAddr)) {
      addr = new inet.SocketAddr({
        address: _options?.address?.host,
        port: _options?.address?.port,
        family: inet.isIPv6(_options?.address?.host || '127.0.0.1') ? 'IPv6' : 'IPv4',
      });
    }

    super();

    this.#options = exclude(_options || {}, 'address');

    this[$addr] = addr;
    this[$handler] = http.createServer(this.#handleIncoming.bind(this));

    const backlog = _options?.backlog || 511;
    assertUnsignedInteger(backlog);

    Object.assign(this.#options || {}, { backlog });

    this.#state = {
      listening: false,
      disposed: false,
      closed: false,
      paused: false,
    };

    if(!_options?.lazy) {
      this.#init();
    }
  }

  public init(): Promise<void> {
    return this.#init();
  }

  #listen(): Promise<void> {
    if(this.#state.listening)
      return Promise.resolve();

    this.#ensureNotDisposed();

    return new Promise((resolve, reject) => {
      this[$handler].once('error', err => {
        if(!(err instanceof Exception)) {
          err = new Exception(err.message || String(err) || 'Unknown error', 'ERR_UNKNOWN_ERROR');
        }

        super.emit('error', err);
        reject(err);
      });

      this[$handler].listen(this[$addr].port, this[$addr].address, this.#options?.backlog, () => {
        this[$handler].on('error', err => {
          if(!(err instanceof Exception)) {
            err = new Exception(err.message || String(err) || 'Unknown error', 'ERR_UNKNOWN_ERROR');
          }
  
          super.emit('error', err);
        });

        this[$handler].on('clientError', err => {
          if(!(err instanceof Exception)) {
            err = new Exception(err.message || String(err) || 'Unknown error', 'ERR_UNKNOWN_ERROR');
          }
  
          super.emit('error', err);
        });

        super.emit('listening', void 0);
        this.#state.listening = true;
        resolve();
      });
    });
  }

  #init(): Promise<void> {
    if(typeof this.#options?.connectionTimeout !== 'number' || this.#options.connectionTimeout < 2)
      return this.#listen();

    return Promise.race<void>([
      this.#listen(),
      new Promise((_, reject) => {
        setTimeout(() => {
          this.dispose();
          const err = new Exception(`Connection timeout exceded in ${this.#options?.connectionTimeout}ms`, 'ERR_TIMEOUT');

          super.emit('error', err);
          reject(err);
        }, this.#options?.connectionTimeout);
      }),
    ]);
  }

  async #handleIncoming(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if(!this.#state.listening)
      return void response
        .writeHead(503, { Connection: 'close', 'Content-Length': 0 })
        .end();
    
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'POST,PUT');
    response.appendHeader('Access-Control-Allow-Credentials', 'false');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if(this.#state.disposed) {
      response
        .writeHead(503, { Connection: 'close', 'Content-Length': 0 })
        .end();
      
      this.#ensureNotDisposed();
    }

    if(request.method?.toLowerCase() === 'options')
      return void response
        .writeHead(204, {
          'Content-Length': 0,
          Connection: 'close',
        })
        .end();

    if(request.method?.toLowerCase() !== 'post')
      return void response
        .writeHead(405, { Connection: 'close', 'Content-Length': 0 })
        .end();

    const url = new URL(request.url || '/', `http://${this[$addr].address}:${this[$addr].port}`);

    if(url.pathname.replace(/\//g, '') !== 'webhook')
      return void response
        .writeHead(418, { Connection: 'close', 'Content-Length': 0 })
        .end();

    try {
      return await new Promise((resolve, reject) => {
        request.once('error', reject);
        const writer = new protocol.BufferWriter();

        request.on('data', chunk => {
          const buffer = chunkToBuffer(chunk);

          if(this.#options?.mask) {
            unmaskBuffer(buffer, chunkToBuffer(this.#options.mask), { avoidBufferUtils: true, pad: true });
          }

          writer.write(buffer);
        });

        request.on('end', async () => {
          try {
            if(writer.buffer.byteLength < 4)
              return void response
                .writeHead(412, { Connection: 'close', 'Content-Length': 0 })
                .end();
  
            const buffer = writer.drain();

            if(typeof this.#options?.maxMessageSize === 'number' && buffer.byteLength > this.#options.maxMessageSize)
              return void response
                .writeHead(413, { Connection: 'close', 'Content-Length': 0 })
                .end();
                
            super.emit('raw-message', Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  
            const message = await parseMessage(buffer, {
              encryptionKey: this.#options?.sec?.encryptionKey,
              salt: this.#options?.sec?.salt,
            });
  
            super.emit('message', message);
  
            response.writeHead(202, {
              Connection: 'close',
              'Content-Length': 0,
            }).end();
  
            resolve();
          } catch (err: any) {
            response
              .writeHead(422, { Connection: 'close', 'Content-Length': 0 })
              .end();

            let e = err;

            if(!(err instanceof Exception)) {
              e = new Exception(err.message || String(err) || 'Unknown error', 'ERR_UNKNOWN_ERROR');
            }
        
            super.emit('error', e);
          }
        });
      });
    } catch (err: any) {
      response
        .writeHead(422, { Connection: 'close', 'Content-Length': 0 })
        .end();

      let e = err;

      if(!(err instanceof Exception)) {
        e = new Exception(err.message || String(err) || 'Unknown error', 'ERR_UNKNOWN_ERROR');
      }

      super.emit('error', e);
      throw err;
    }
  }

  #ensureNotDisposed(): void {
    if(this.#state.disposed) {
      const err = new Exception('This webhook server instance is already disposed', 'ERR_RESOURCE_DISPOSED');

      super.emit('error', err);
      throw err;
    }
  }

  public onmessage<TPayload = unknown>(callback: (event: IEvent<ParsedMessage<TPayload>, never>) => void, thisArgs?: any): this {
    this.#ensureNotDisposed();

    super.addListener('message', callback as () => void, thisArgs, { once: false });
    return this;
  }

  public oncemessage<TPayload = unknown>(callback: (event: IEvent<ParsedMessage<TPayload>, never>) => void, thisArgs?: any): this {
    this.#ensureNotDisposed();

    super.addListener('message', callback as () => void, thisArgs, { once: true });
    return this;
  }

  public on<K extends keyof WebhookServerDefaultEventsMap>(
    event: LooseAutocomplete<K>,
    listener: (event: IEvent<WebhookServerDefaultEventsMap[K], never>) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    super.addListener(event, listener as () => void, thisArgs, { once: false });
    return this;
  }

  public once<K extends keyof WebhookServerDefaultEventsMap>(
    event: LooseAutocomplete<K>,
    listener: (event: IEvent<WebhookServerDefaultEventsMap[K], never>) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    super.addListener(event, listener as () => void, thisArgs, { once: true });
    return this;
  }

  public off<K extends keyof WebhookServerDefaultEventsMap>(
    event: LooseAutocomplete<K>,
    listener: (event: IEvent<WebhookServerDefaultEventsMap[K], never>) => void // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    super.removeListener(event, listener as () => void);
    return this;
  }

  public close(): Promise<void> {
    if(this.#state.closed)
      return Promise.resolve();

    this.#ensureNotDisposed();
    
    return new Promise(resolve => {
      this[$handler].close(() => {
        this.#state.closed = true;
        super.emit('close', void 0);

        resolve();
      });
    });
  }

  public dispose(): void {
    super.dispose();

    if(!this.#state.disposed) {
      this.close()
        .then(() => { (this as any)[$handler] = null; });

      super.emit('dispose', void 0);
      this.#state.disposed = true;
    }
  }
}
