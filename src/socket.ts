import * as net from 'node:net';
import * as dgram from 'node:dgram';

import { Async } from '@rapid-d-kit/async';
import { IDisposable } from '@rapid-d-kit/disposable';
import { assertDefinedString } from '@rapid-d-kit/safe';
import type { LooseAutocomplete } from '@rapid-d-kit/types';
import { chunkToBuffer, mask as maskBuffer, unmask as unmaskBuffer } from '@ts-overflow/node.std';
import { IOStream, option, ICancellationToken, CancellationToken, CancellationTokenSource } from 'ndforge';

import * as inet from './inet';
import * as protocol from './protocol';
import { EventEmitter } from './emitter';
import { AF_INET, AF_INET6 } from './inet';
import { Exception } from './@internals/errors';
import { Either, left, right } from './@internals/either';

export { AF_INET, AF_INET6, AF_LOCAL, AF_MAX } from './inet';


export const SOCK_STREAM = 0x1;
export const SOCK_DGRAM = 0x2;

const $handler = Symbol('kSockHandler');
const $addr = Symbol('kAddressHandle');


export interface DefaultSocketEventsMap {
  close: [];
  drain: [];
  flushing: [];
  data: [ message: Buffer ];
}

export interface DefaultSocketServerEventsMap {
  close: [];
  listening: [ server: TCPServer ];
  connection: [ socket: ReturnType<typeof option<TCPSocket>> ];
}


export interface IAbstractSocket {
  on(event: string, callback: (...args: any[]) => void): void;
  once(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;

  close(): void;
}

export interface NetworkSocket extends IAbstractSocket {
  write(payload: Buffer): boolean;
  on(event: 'data', callback: (message: Buffer) => void): void;
}

export type DefaultSettings = {
  'supress cancellation error': boolean;
  mask: Uint8Array;
};


type SocketState = {
  closed: boolean;
  flushing: boolean;
  disposed: boolean;
}

class TCPSocket extends EventEmitter implements NetworkSocket, IDisposable {
  readonly #source: CancellationTokenSource;
  readonly #state: SocketState;
  #mask?: Uint8Array;

  readonly [$handler]: net.Socket;
  readonly [$addr]: inet.SocketAddr;

  public constructor(addrOrSocket: inet.SocketAddr | net.Socket, token: ICancellationToken = CancellationToken.None) {
    super();

    if(addrOrSocket instanceof net.Socket) {
      this[$handler] = addrOrSocket;
      this[$addr] = new inet.SocketAddr({
        address: addrOrSocket.remoteAddress,
        port: addrOrSocket.remotePort || 0,
        family: addrOrSocket.remoteFamily === 'IPv6' ? 'IPv6' : 'IPv4',
      });

      token.onCancellationRequested(() => void this.dispose());
    } else {
      if(!(addrOrSocket instanceof inet.SocketAddr)) {
        throw new Exception(`Unable to construct a TCP socket with address 'typeof ${typeof addrOrSocket}'`, 'ERR_INVALID_ARGUMENT');
      }

      this.#source = new CancellationTokenSource(token);
      const ac = new AbortController();

      this.#source.token.onCancellationRequested(reason => {
        ac.abort(reason);
        this.dispose();
      });

      this[$addr] = addrOrSocket;
      this[$handler] = new net.Socket({ signal: ac.signal });
    }

    this.#state = {
      closed: false,
      disposed: false,
      flushing: false,
    };
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this[$handler].once('error', reject);

      this[$handler].connect({
        host: this[$addr].address,
        port: this[$addr].port,
        path: '/',
      }, () => {
        this.#state.flushing = true;
        this[$handler].on('drain', () => void super.emit('drain', null));
        super.emit('flushing', null);

        this[$handler].on('data', chunk => {
          const buffer = chunkToBuffer(chunk);

          if(this.#mask) {
            unmaskBuffer(buffer, chunkToBuffer(this.#mask), { avoidBufferUtils: true, pad: true });
          }

          super.emit('data', buffer);
        });
        
        Async.wrapResolveOnNextTick(resolve);
      });
    });
  }

  public send(value: any): boolean {
    this.#ensureNotDisposed();

    const writer = new protocol.BufferWriter();
    protocol.serialize(writer, value);

    return this.#write(writer);
  }

  public write(value: Buffer): boolean {
    this.#ensureNotDisposed();
    return this.#write(value);
  }

  public on<K extends keyof DefaultSocketEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketEventsMap[K] extends unknown[] ? DefaultSocketEventsMap[K] : [DefaultSocketEventsMap[K]]) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    super.addListener(event, callback as () => void, thisArgs, { once: false });
    return this;
  }

  public once<K extends keyof DefaultSocketEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketEventsMap[K] extends unknown[] ? DefaultSocketEventsMap[K] : [DefaultSocketEventsMap[K]]) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    super.addListener(event, callback as () => void, thisArgs, { once: true });
    return this;
  }

  public off<K extends keyof DefaultSocketEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketEventsMap[K] extends unknown[] ? DefaultSocketEventsMap[K] : [DefaultSocketEventsMap[K]]) => void // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    super.removeListener(event, callback as () => void);
    return this;
  }

  public close(): void {
    this.#ensureNotDisposed();

    if(this.#state.closed) return;

    this[$handler].end(() => {
      super.emit('close', null);
      this.#source.cancel();
    });

    this.#state.closed = true;
  }

  public override dispose(): void {
    super.dispose();

    if(!this.#state.disposed) {
      this.close();
      this.#state.disposed = true;
    }
  }

  #write(payload: Buffer | protocol.IWriter): boolean {
    this.#ensureNotDisposed();

    if(!Buffer.isBuffer(payload)) {
      payload = payload.drain();
    }

    if(this.#mask) {
      let output = Buffer.alloc(payload.length);
      maskBuffer(payload, chunkToBuffer(this.#mask), output, 0, payload.length, { avoidBufferUtils: true, pad: true });

      payload = output;
      output = null!;
    }
    
    if(!this[$handler].write(payload)) {
      this.#state.flushing = false;

      super.addListener('drain', () => {
        this.#state.flushing = true;
        super.emit('flushing', null);
      }, null, { once: true });

      return false;
    }

    return true;
  }

  #ensureNotDisposed(): void {
    if(this.#state.disposed) {
      throw new Exception('This socket is already disposed', 'ERR_RESOURCE_DISPOSED');
    }
  }
}

export interface ITCPSocket extends TCPSocket { }


class UDPSocket extends EventEmitter implements NetworkSocket {
  readonly #source: CancellationTokenSource;

  readonly [$handler]: dgram.Socket;
  readonly [$addr]: inet.SocketAddr;

  public constructor(addrOrSocket: inet.SocketAddr | dgram.Socket, token: ICancellationToken = CancellationToken.None) {
    super();

    if(addrOrSocket instanceof dgram.Socket) {
      const addr = addrOrSocket.remoteAddress();

      this[$handler] = addrOrSocket;
      this[$addr] = new inet.SocketAddr({
        address: addr.address,
        family: addr.family.toLowerCase() === 'ipv6' ? 'IPv6' : 'IPv4',
        port: addr.port,
      });
    } else {
      if(!(addrOrSocket instanceof inet.SocketAddr)) {
        throw new Exception(`Unable to construct a UDP socket with address 'typeof ${typeof addrOrSocket}'`, 'ERR_INVALID_ARGUMENT');
      }

      
      this.#source = new CancellationTokenSource(token);
      const ac = new AbortController();

      this.#source.token.onCancellationRequested(reason => {
        ac.abort(reason);
      });

      this[$addr] = addrOrSocket;
      this[$handler] = dgram.createSocket({ type: addrOrSocket.type === AF_INET ? 'udp4' : 'udp6', signal: ac.signal });
    }
  }

  public write(payload: Buffer): boolean {
    throw new IOStream.Exception.NotImplemented('UDPSocket.write()', [payload]);
  }

  public on<K extends keyof DefaultSocketEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketEventsMap[K] extends unknown[] ? DefaultSocketEventsMap[K] : [DefaultSocketEventsMap[K]]) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    super.addListener(event, callback as () => void, thisArgs, { once: false });
    return this;
  }

  public once<K extends keyof DefaultSocketEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketEventsMap[K] extends unknown[] ? DefaultSocketEventsMap[K] : [DefaultSocketEventsMap[K]]) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    super.addListener(event, callback as () => void, thisArgs, { once: true });
    return this;
  }

  public off<K extends keyof DefaultSocketEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketEventsMap[K] extends unknown[] ? DefaultSocketEventsMap[K] : [DefaultSocketEventsMap[K]]) => void // eslint-disable-line comma-dangle
  ): this {
    super.removeListener(event, callback as () => void);
    return this;
  }

  public close(): void {
    this[$handler].close(() => {
      super.emit('close', null);
      this.#source.cancel();
    });
  }
}

export interface IUDPSocket extends UDPSocket { }


type ServerState = {
  closed: boolean;
  disposed: boolean;
  listening: boolean;
};

class TCPServer extends EventEmitter implements IDisposable {
  readonly #clients: Map<inet.SocketAddr, TCPSocket>;
  readonly #settings: Map<string, unknown>;
  readonly #state: ServerState;

  readonly [$handler]: net.Server;
  readonly [$addr]: inet.SocketAddr;

  public constructor(addr: inet.SocketAddr, token: ICancellationToken = CancellationToken.None) {
    if(!(addr instanceof inet.SocketAddr)) {
      throw new Exception(`Unable to construct a TCP socket server with address 'typeof ${typeof addr}'`, 'ERR_INVALID_ARGUMENT');
    }

    super();

    this.#settings = new Map();
    this.#clients = new Map();
    token.onCancellationRequested(reason => this.#handleCancellation(reason));

    this[$addr] = addr;
    
    this[$handler] = net.createServer(sock => {
      if(token.isCancellationRequested) {
        sock.end();
        sock.destroy();
        return;
      }

      const addr = new inet.SocketAddr({
        address: sock.remoteAddress,
        port: sock.remotePort || 0,
        family: sock.remoteFamily === 'IPv6' ? 'IPv6' : 'IPv4',
      });
      
      const socket = super._register(new TCPSocket(sock));

      this.#clients.set(addr, socket);
      this.emit('connection', socket);
    });

    this.#state = {
      closed: false,
      disposed: false,
      listening: false,
    };
  }

  public listen(backlog: number = 511): Promise<void> {
    this.#ensureNotDisposed();
    
    if(this.#state.listening) {
      throw new Exception('The server is already listening for connections', 'ERR_ONCE_METHOD_CALLED_AGAIN');
    }

    return new Promise((resolve, reject) => {
      this[$handler].on('error', reject);

      this[$handler].listen(this[$addr].port, this[$addr].address, backlog, () => {
        super.emit('listening', this);
        this.#state.listening = true;

        Async.wrapResolveOnNextTick(resolve);
      });
    });
  }

  public set<K extends keyof DefaultSettings>(setting: LooseAutocomplete<K>, value: DefaultSettings[K]): this {
    this.#ensureNotDisposed();

    assertDefinedString(setting);
    this.#settings.set(setting, value);

    return this;
  }

  public get<K extends keyof DefaultSettings>(setting: LooseAutocomplete<K>): DefaultSettings[K] | undefined {
    this.#ensureNotDisposed();

    assertDefinedString(setting);
    return this.#settings.get(setting) as any;
  }

  public send(target: inet.SocketAddr, payload: any): boolean {
    const writer = new protocol.BufferWriter();
    protocol.serialize(writer, payload);

    return this.#write(target, writer);
  }

  public write(target: inet.SocketAddr, payload: Buffer): boolean {
    return this.#write(target, payload);
  }

  public close(): Promise<void> {
    this.#ensureNotDisposed();
    if(this.#state.closed) return Promise.resolve();

    return new Promise(resolve => {
      this[$handler].close(() => {
        super.emit('close', null);
        this.#state.closed = true;

        Async.wrapResolveOnNextTick(resolve);
      });
    });
  }

  public dispose(): void {
    super.dispose();

    if(!this.#state.disposed) {
      this.close();
      this.#settings.clear();

      for(const socket of this.#clients.values()) {
        socket.close();
      }

      this.#clients.clear();
      this.#state.disposed = true;
    }
  }

  public on<K extends keyof DefaultSocketServerEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketServerEventsMap[K] extends unknown[] ? DefaultSocketServerEventsMap[K] : [DefaultSocketServerEventsMap[K]]) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();
    
    super.addListener(event, callback as () => void, thisArgs, { once: false });
    return this;
  }

  public once<K extends keyof DefaultSocketServerEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketServerEventsMap[K] extends unknown[] ? DefaultSocketServerEventsMap[K] : [DefaultSocketServerEventsMap[K]]) => void,
    thisArgs?: any // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();
    
    super.addListener(event, callback as () => void, thisArgs, { once: true });
    return this;
  }

  public off<K extends keyof DefaultSocketServerEventsMap>(
    event: LooseAutocomplete<K>,
    callback: (...args: DefaultSocketServerEventsMap[K] extends unknown[] ? DefaultSocketServerEventsMap[K] : [DefaultSocketServerEventsMap[K]]) => void // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();
    
    super.removeListener(event, callback as () => void);
    return this;
  }

  #handleCancellation(reason?: any): void {
    this.close();
    this.dispose();

    if(this.#settings.get('supress cancellation error') !== true) {
      throw new Exception(`TCP socket server was closed by cancellation token due to "${reason || 'unknown reason'}"`, 'ERR_TOKEN_CANCELLED');
    }
  }

  #ensureNotDisposed(): void {
    if(this.#state.disposed) {
      throw new Exception('This server instance is already disposed', 'ERR_RESOURCE_DISPOSED');
    }
  }

  #write(to: inet.SocketAddr, payload: Buffer | protocol.IWriter): boolean {
    const mask = this.#settings.get('mask') as Uint8Array | undefined;

    if(!Buffer.isBuffer(payload)) {
      payload = payload.drain();
    }

    if(mask) {
      let output = Buffer.alloc(payload.length);
      maskBuffer(payload, chunkToBuffer(mask), output, 0, payload.length, { avoidBufferUtils: true, pad: true });

      payload = output;
      output = null!;
    }

    for(const [address, socket] of this.#clients.entries()) {
      if(
        address.address === to.address &&
        address.port === to.port &&
        address.type === to.type
      ) {
        return socket.write(payload);
      }
    }

    return true;
  }
}

export interface ITCPServer extends TCPServer { }


class UDPServer extends EventEmitter implements IDisposable { }

export interface IUDPServer extends UDPServer { }


export function createSocket(
  family: typeof AF_INET | typeof AF_INET6,
  kind: typeof SOCK_STREAM,
  addr: number | inet.SocketAddr,
  token?: ICancellationToken
): Either<Exception | IOStream.Exception.NotImplemented, ReturnType<typeof option<TCPSocket>>>;

export function createSocket(
  family: typeof AF_INET | typeof AF_INET6,
  kind: typeof SOCK_DGRAM,
  addr: number | inet.SocketAddr,
  token?: ICancellationToken
): Either<Exception | IOStream.Exception.NotImplemented, ReturnType<typeof option<UDPSocket>>>;

export function createSocket(
  family: number,
  kind: number,
  addr: number | inet.SocketAddr,
  token?: ICancellationToken // eslint-disable-line comma-dangle
): Either<Exception | IOStream.Exception.NotImplemented, ReturnType<typeof option<TCPSocket | UDPSocket>>> {
  if(![inet.AF_INET, inet.AF_INET6].includes(family)) {
    throw new IOStream.Exception.NotImplemented('__buildNonInetSocket()');
  }

  const address = addr instanceof inet.SocketAddr ? addr : new inet.SocketAddr({ port: addr });

  try {
    if(kind === SOCK_DGRAM)
      return right(option(new UDPSocket(address, token)));

    if(kind === SOCK_STREAM)
      return right(option(new TCPSocket(address, token)));

    throw new Exception(`Unknown socket kind (0x${(typeof kind === 'number' ? kind : -1).toString(16)})`, 'ERR_INVALID_ARGUMENT');
  } catch (err: any) {
    let e = err;

    if(!(err instanceof Exception) && !(err instanceof IOStream.Exception.NotImplemented)) {
      e = new Exception(err.message || String(err) || `Something failed while creating a socket (0x${kind.toString(16)})`, 'ERR_UNKNOWN_ERROR');
    }

    return left(e);
  }
}


export function createServer(
  family: typeof AF_INET | typeof AF_INET6,
  kind: typeof SOCK_STREAM,
  addr: number | inet.SocketAddr,
  token?: ICancellationToken
): Either<Exception | IOStream.Exception.NotImplemented, ReturnType<typeof option<TCPServer>>>;

export function createServer(
  family: typeof AF_INET | typeof AF_INET6,
  kind: typeof SOCK_DGRAM,
  addr: number | inet.SocketAddr,
  token?: ICancellationToken
): Either<Exception | IOStream.Exception.NotImplemented, ReturnType<typeof option<UDPServer>>>;

export function createServer(
  family: number,
  kind: number,
  addr: number | inet.SocketAddr,
  token?: ICancellationToken // eslint-disable-line comma-dangle
): Either<Exception | IOStream.Exception.NotImplemented, ReturnType<typeof option<TCPServer | UDPServer>>> {
  if(![inet.AF_INET, inet.AF_INET6].includes(family)) {
    throw new IOStream.Exception.NotImplemented('__buildNonInetSocket()');
  }

  const address = addr instanceof inet.SocketAddr ? addr : new inet.SocketAddr({ port: addr });

  try {
    if(kind === SOCK_DGRAM) {
      throw new IOStream.Exception.NotImplemented('__buildDgramSocketServer()');
    }

    if(kind === SOCK_STREAM)
      return right(option(new TCPServer(address, token)));

    throw new Exception(`Unknown socket kind (0x${(typeof kind === 'number' ? kind : -1).toString(16)})`, 'ERR_INVALID_ARGUMENT');
  } catch (err: any) {
    let e = err;

    if(!(err instanceof Exception) && !(err instanceof IOStream.Exception.NotImplemented)) {
      e = new Exception(err.message || String(err) || `Something failed while creating a socket server (0x${kind.toString(16)})`, 'ERR_UNKNOWN_ERROR');
    }

    return left(e);
  }
}
