import * as net from 'node:net';
import { assertDefinedString, assertUnsignedInteger } from '@rapid-d-kit/safe';

import bitwise from './@internals/bitwise';
import Exception from './@internals/errors';
import { IInspectable } from './@internals/inspect';

export { isIP, isIPv4, isIPv6 } from 'node:net';


export const AF_LOCAL = 0x1;
export const AF_INET = 0x2;
export const AF_INET6 = 0xA;
export const AF_MAX = 0x2E;


type SA = {
  address: string;
  port: number;
  flowLabel: number;
  family: number;
};

export class SocketAddr implements IInspectable<SA> {
  readonly #details: SA;

  public constructor(_options: Omit<net.SocketAddressInitOptions, 'family'> & { family?: 'IPv4' | 'IPv6' } = {}) {
    const { family = 'IPv4' } = _options;

    const {
      address = (String(family).toLowerCase() === 'ipv4' ? '127.0.0.1' : '::'),
      port = 0,
      flowlabel = 0,
    } = _options;
    
    let type;

    switch(String(family).toLowerCase()) {
      case 'ipv4':
        type = AF_INET;
        break;
      case 'ipv6':
        type = AF_INET6;
        break;
      default:
        throw new Exception('Invalid inet family', 'ERR_INVALID_ARGUMENT');
    }
    
    assertDefinedString(address);

    if(!validatePort(port)) {
      throw new Exception('Invalid port value, it must be 0 or in range 1024 to 65535', 'ERR_INVALID_ARGUMENT');
    }

    assertUnsignedInteger(flowlabel);
    
    this.#details = {
      address,
      port,
      flowLabel: flowlabel,
      family: type,
    };
  }

  public get family(): 'IPv4' | 'IPv6' {
    return this.#details.family === AF_INET ? 'IPv4' : 'IPv6';
  }

  public get address(): string {
    return this.#details.address.slice(0);
  }

  public get port(): number {
    return this.#details.port;
  }

  public get flowLabel(): number {
    return this.#details.flowLabel;
  }

  public get type(): number {
    return this.#details.family;
  }

  public $inspect(): SA {
    return { ...this.#details };
  }
}


export function validatePort(value: unknown): value is number {
  if(typeof value !== 'number')
    return false;

  if(bitwise.or(value, 0) !== value)
    return false;

  if(value === 0)
    return true;

  return value >= 1024 && value <= 65535;
}
