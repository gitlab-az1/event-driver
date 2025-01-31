import { IOStream } from 'ndforge';
import { createHash } from 'node:crypto';
import { timestamp } from 'ndforge/timer';
import { chunkToBuffer } from '@ts-overflow/node.std';
import type { BufferLike, Dict, ReadonlyDict } from '@rapid-d-kit/types';

import crypto from './@internals/crypto';
import Exception from './@internals/errors';
import Marshalling from './@internals/marshalling';
import { BufferReader, BufferWriter, deserialize, serialize } from './protocol';


// Binary Message Strcture:
// 
// +-------------------------+
// |      Topic (string)     |
// +-------------------------+
// |     Encrypted (uint)    |
// +-------------------------+
// |      Headers (JSON)     |
// +-------------------------+
// |      Payload (JSON)     |
// +-------------------------+
// |  Sign Algorithm (uint)  |
// +-------------------------+
// |        Signature        |
// +-------------------------+


export type SignA =
  | 'RSA-RIPEMD160'
  | 'RSA-SHA512/224'
  | 'RSA-SM3'
  | 'blake2b512'
  | 'blake2s256'
  | 'id-rsassa-pkcs1-v1_5-with-sha3-256'
  | 'ripemd160'
  | 'sha512'
  | 'sha512-224'
  | 'hmac-sha256'
  | 'hmac-sha512'
  | 'shake256'
  | 'ssl3-sha1';


export interface PresetMessageHeaders {
  timestamp: number;
  byteLength: number;
}

export type MessageHeaders = {
  [key: Exclude<string, keyof PresetMessageHeaders>]: string | number | boolean | null;
} & PresetMessageHeaders;


export type MessageInit<T> = {
  headers?: Dict<string | number | boolean | null>;
  payload: T;
  topic: string;
  encryptionKey?: BufferLike;
  signAlgorithm?: SignA;
  salt?: BufferLike;
};

export interface ParsedMessage<T> {
  readonly topic: string;
  readonly headers: MessageHeaders;
  readonly payload: T;
}


export async function createMessage<T>(init: MessageInit<T>): Promise<Buffer> {
  const writer = new BufferWriter();

  try {
    serialize(writer, Marshalling.encode(init.payload));
  } catch {
    serialize(writer, init.payload);
  }

  const payload = await encryptIfKey(writer.drain(), init.encryptionKey);

  const headers: MessageHeaders = {
    ...init.headers,
    timestamp: timestamp(),
    byteLength: payload.byteLength - 1,
  };

  serialize(writer, init.topic);
  // eslint-disable-next-line no-extra-boolean-cast
  serialize(writer, !!init.encryptionKey ? 1 : 0);
  serialize(writer, headers);
  
  // eslint-disable-next-line no-extra-boolean-cast
  if(!!init.encryptionKey) {
    serialize(writer, payload);
  } else {
    writer.write(payload);
  }

  serialize(writer, SignAlgorithmsToNumber[init.signAlgorithm || 'sha512']);

  const signature = await sign(init.signAlgorithm || 'sha512', init.payload, headers, init.salt);
  serialize(writer, signature);

  return writer.drain();
}

export async function parseMessage<T = unknown>(
  message: BufferLike,
  options?: Pick<MessageInit<T>, 'encryptionKey' | 'salt'> // eslint-disable-line comma-dangle
): Promise<ParsedMessage<T>> {
  const reader = new BufferReader(chunkToBuffer(message));

  const topic = deserialize(reader);
  const isEncrypted = deserialize(reader) === 1;
  const headers = deserialize<MessageHeaders>(reader);
  
  let payload: any = deserialize(reader);

  if(isEncrypted && Buffer.isBuffer(payload)) {
    if(!options?.encryptionKey) {
      throw new Exception('You must provide an encryption key to unwrap this message', 'ERR_INVALID_ARGUMENT');
    }

    const decrypted = await crypto.decrypt(
      'aes_cbc_256',
      chunkToBuffer(options.encryptionKey),
      payload // eslint-disable-line comma-dangle
    );

    payload = deserialize(new BufferReader(decrypted));
  }

  const sa = deserialize(reader);
  const cs = await sign(sa, payload, headers, options?.salt);

  if(!cs.equals(deserialize(reader))) {
    throw new Exception('Failed to validate the integrity of this message', 'ERR_INVALID_SIGNATURE');
  }

  return Object.freeze<ParsedMessage<T>>({
    topic,
    headers,
    payload,
  });
}



function sign(algorithm: SignA | number, payload: any, headers?: MessageHeaders, salt?: BufferLike): Promise<Buffer> {
  if(typeof algorithm === 'number') {
    algorithm = SignAlgorithmsToString[algorithm] as SignA;
  }

  const writer = new BufferWriter();
  serialize(writer, headers);

  try {
    serialize(writer, Marshalling.encode(payload));
  } catch {
    serialize(writer, payload);
  }

  const reader = new BufferReader(writer.drain());

  switch(algorithm) {
    case 'sha512': {
      const hash = createHash('sha512');

      while(reader.readable) {
        hash.update(reader.read(1024 * 3));
      }

      return Promise.resolve(hash.digest());
    } break;
    default:
      throw new IOStream.Exception.NotImplemented('__signBuf()', [salt]);
  }
}

async function encryptIfKey(payload: BufferLike, key?: BufferLike): Promise<Buffer> {
  if(!key)
    return chunkToBuffer(payload);

  return await crypto.encrypt(
    'aes_cbc_256',
    chunkToBuffer(key),
    payload // eslint-disable-line comma-dangle
  );
}


const SignAlgorithmsToNumber: ReadonlyDict<number> = Object.freeze({
  'RSA-RIPEMD160': 0,
  'RSA-SHA512/224': 1,
  'RSA-SM3': 2,
  blake2b512: 3,
  blake2s256: 4,
  'id-rsassa-pkcs1-v1_5-with-sha3-256': 5,
  ripemd160: 6,
  sha512: 7,
  'sha512-224': 8,
  'hmac-sha256': 9,
  'hmac-sha512': 10,
  shake256: 11,
  'ssl3-sha1': 12,
});

const SignAlgorithmsToString: Record<number, string> = Object.freeze({
  0: 'RSA-RIPEMD160',
  1: 'RSA-SHA512/224',
  2: 'RSA-SM3',
  3: 'blake2b512',
  4: 'blake2s256',
  5: 'id-rsassa-pkcs1-v1_5-with-sha3-256',
  6: 'ripemd160',
  7: 'sha512',
  8: 'sha512-224',
  9: 'hmac-sha256',
  10: 'hmac-sha512',
  11: 'shake256',
  12: 'ssl3-sha1',
});
