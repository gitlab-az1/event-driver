import * as nodec from 'node:crypto';
import { jsonSafeParser } from 'ndforge';
import { AES, SymmetricKey } from 'cryptx-sdk/symmetric';

import { Exception } from './errors';


// eslint-disable-next-line @typescript-eslint/no-namespace
namespace crypto {
  export enum algorithms {
    aes_gcm_128,
    aes_cbc_128,
    aes_gcm_256,
    aes_cbc_256,
    xaes_gcm_hmac_256,
    xaes_cbc_hmac_256,
  }

  export function encrypt(
    algorithm: keyof typeof algorithms,
    _key: Buffer,
    content: any): Promise<Buffer>;

  export function encrypt(
    algorithm: keyof typeof algorithms,
    _key: Buffer,
    content: any,
    encoding: BufferEncoding): Promise<string>;

  export function encrypt(
    algorithm: keyof typeof algorithms,
    _key: Buffer,
    content: Uint8Array,
    encoding?: BufferEncoding): Promise<Buffer | string> {
    if(algorithm.includes('hmac_256')) return _encryptWithHmac(algorithm, _key, Buffer.isBuffer(content) ? content : Buffer.from(content), encoding);
    return _encryptWithoutHmac(algorithm, _key, Buffer.isBuffer(content) ? content : Buffer.from(content), encoding);
  }

  export function decrypt<K extends keyof typeof algorithms = keyof typeof algorithms>(
    algorithm: K,
    _key: Buffer,
    content: Buffer): Promise<K extends 'xaes_gcm_hmac_256' | 'xaes_cbc_hmac_256' ? { readonly signature: Buffer; readonly payload: Buffer } : Buffer>;

  export function decrypt<T = any, K extends keyof typeof algorithms = keyof typeof algorithms>(
    algorithm: K,
    _key: Buffer,
    content: Buffer,
    encoding: '_json'): Promise<K extends 'xaes_gcm_hmac_256' | 'xaes_cbc_hmac_256' ? { readonly signature: Buffer; readonly payload: T } : T>;

  export function decrypt<K extends keyof typeof algorithms = keyof typeof algorithms>(
    algorithm: K,
    _key: Buffer,
    content: Buffer,
    encoding: BufferEncoding): Promise<K extends 'xaes_gcm_hmac_256' | 'xaes_cbc_hmac_256' ? { readonly signature: Buffer; readonly payload: string } : string>;

  export async function decrypt<T = any, K extends keyof typeof algorithms = keyof typeof algorithms>(
    algorithm: K,
    _key: Buffer,
    content: Buffer,
    encoding?: BufferEncoding | '_json'): Promise<{ readonly signature: Buffer; readonly payload: T | Buffer | string } | T | Buffer | string> {
    let output: {
      payload: any;
      signature?: Buffer;
    } = { payload: null };

    if(algorithm.includes('_hmac_256')) {
      const [dec, sign] = await _decryptWithHmac(content, _key);

      if(encoding === '_json') {
        const parsed = jsonSafeParser<T>(dec.toString('utf-8'));

        if(parsed.isLeft()) {
          throw parsed.value;
        }

        output = {
          payload: parsed.value,
          signature: sign,
        };
      } else if(!!encoding && Buffer.isEncoding(encoding)) {
        output = {
          payload: dec.toString(encoding),
          signature: sign,
        };
      } else {
        output = {
          payload: dec,
          signature: sign,
        };
      }
    } else {
      output = {
        payload: (await _decryptWithoutHmac(content, _key, !!encoding && Buffer.isEncoding(encoding) ? encoding : undefined)),
      };
    }

    if(!output.signature) return output.payload;
    return Object.freeze(output) as any;
  }
}


async function _encryptWithHmac(algorithm: keyof typeof crypto.algorithms, key: Buffer, content: any, encoding?: BufferEncoding): Promise<Buffer | string> {
  if(!['xaes_gcm_hmac_256', 'xaes_cbc_hmac_256'].includes(algorithm)) {
    throw new Exception(`Cannot create '${algorithm}' cipher`, 'ERR_CRYPTO_INVALID_ALGORITHM');
  }

  const k = new SymmetricKey(key, {
    algorithm: algorithm === 'xaes_cbc_hmac_256' ? 'aes-256-cbc' : 'aes-256-gcm',
    usages: ['encrypt', 'decrypt', 'sign', 'verify'],
  });

  const aes = new AES(k, algorithm === 'xaes_gcm_hmac_256' ? 'aes-256-gcm' : 'aes-256-cbc');
  const e = await aes.encrypt(content);
  const buf = Buffer.alloc(e.buffer.byteLength + 1);

  buf.writeUint8(crypto.algorithms[algorithm], 0);

  for(let i = 0; i < e.buffer.length; i++) {
    buf[i + 1] = e.buffer[i];
  }

  if(!encoding) return buf;
  return buf.toString(encoding);
}

function _encryptWithoutHmac(algorithm: keyof typeof crypto.algorithms, skey: Buffer, content: any, encoding?: BufferEncoding): Promise<Buffer | string> {
  const { iv, key } = _consumeKey(algorithm, skey);
  const cipher = nodec.createCipheriv(_getNodeAlgorithm(algorithm), key, iv);

  const enc = Buffer.concat([cipher.update(Buffer.isBuffer(content) ? content : Buffer.from(content)), cipher.final()]);
  cipher.destroy();

  const output = Buffer.alloc(enc.byteLength + 1);
  output.writeUint8(crypto.algorithms[algorithm], 0);

  for(let i = 0; i < enc.length; i++) {
    output[i + 1] = enc[i];
  }

  if(!encoding) return Promise.resolve(output);
  return Promise.resolve(output.toString(encoding));
}


async function _decryptWithHmac(input: Buffer, skey: Buffer, encoding?: BufferEncoding): Promise<readonly [Buffer | string, Buffer]> {
  const algorithm = input.readUint8(0);

  if(!['xaes_gcm_hmac_256', 'xaes_cbc_hmac_256'].includes(crypto.algorithms[algorithm])) {
    throw new Exception(`Cannot create '${algorithm}' cipher`, 'ERR_CRYPTO_INVALID_ALGORITHM');
  }

  const k = new SymmetricKey(skey, {
    algorithm: crypto.algorithms[algorithm] === 'xaes_cbc_hmac_256' ? 'aes-256-cbc' : 'aes-256-gcm',
    usages: ['encrypt', 'decrypt', 'sign', 'verify'],
  });

  const aes = new AES(k, crypto.algorithms[algorithm] === 'xaes_gcm_hmac_256' ? 'aes-256-gcm' : 'aes-256-cbc');
  const dec = await aes.decrypt<any>(input.subarray(1));
  
  if(!encoding) return [Buffer.from(dec.payload, 'utf-8'), Buffer.isBuffer(dec.signature) ? dec.signature : Buffer.from(dec.signature)];
  return [Buffer.from(dec.payload, 'utf-8').toString(encoding), Buffer.isBuffer(dec.signature) ? dec.signature : Buffer.from(dec.signature)];
}

function _decryptWithoutHmac(input: Buffer, skey: Buffer, encoding?: BufferEncoding): Promise<Buffer | string> {
  const algorithm = input.readUint8(0);

  if(['xaes_gcm_hmac_256', 'xaes_cbc_hmac_256'].includes(crypto.algorithms[algorithm])) {
    throw new Exception(`Cannot create '${algorithm}' cipher`, 'ERR_CRYPTO_INVALID_ALGORITHM');
  }

  const { iv, key, authTag } = _consumeKey(crypto.algorithms[algorithm] as unknown as crypto.algorithms, skey);
  const cipher = nodec.createDecipheriv(_getNodeAlgorithm(crypto.algorithms[algorithm] as unknown as crypto.algorithms), key, iv);

  if(!!authTag && Buffer.isBuffer(authTag)) {
    (<any>cipher).setAuthTag(authTag);
  }

  const output = Buffer.concat([cipher.update(input.subarray(1)), cipher.final()]);
  cipher.destroy();

  if(!encoding) return Promise.resolve(output);
  return Promise.resolve(output.toString(encoding));
}


function _getNodeAlgorithm(alg: keyof typeof crypto.algorithms | crypto.algorithms): string {
  switch(alg) {
    case 'aes_cbc_128':
    case crypto.algorithms.aes_cbc_128:
      return 'aes-128-cbc';
    case 'aes_cbc_256':
    case crypto.algorithms.aes_cbc_256:
      return 'aes-256-cbc';
    case 'aes_gcm_128':
    case crypto.algorithms.aes_gcm_128:
      return 'aes-128-gcm';
    case 'aes_gcm_256':
    case crypto.algorithms.aes_gcm_256:
      return 'aes-256-gcm';
    default:
      throw new Exception(`Cannot create '${alg}' cipher`, 'ERR_CRYPTO_INVALID_ALGORITHM');
  }
}


type DearmoredKey = {
  key: Buffer;
  iv: Buffer;
  authTag?: Buffer;
}

function _consumeKey(algorithm: keyof typeof crypto.algorithms | crypto.algorithms, superkey: Buffer): DearmoredKey {
  const algoMap: { [key: string]: { keyLen: number; ivLen: number; authTagLen?: number }} = {
    'aes_cbc_128': { keyLen: 16, ivLen: 16 },
    'aes_cbc_256': { keyLen: 32, ivLen: 16 },
    'aes_gcm_128': { keyLen: 16, ivLen: 12, authTagLen: 16 },
    'aes_gcm_256': { keyLen: 32, ivLen: 12, authTagLen: 16 },
  };

  const enumAlgoMap: { [key: string | number]: { keyLen: number; ivLen: number; authTagLen?: number }} = {
    [crypto.algorithms.aes_cbc_128]: { keyLen: 16, ivLen: 16 },
    [crypto.algorithms.aes_cbc_256]: { keyLen: 32, ivLen: 16 },
    [crypto.algorithms.aes_gcm_128]: { keyLen: 16, ivLen: 12, authTagLen: 16 },
    [crypto.algorithms.aes_gcm_256]: { keyLen: 32, ivLen: 12, authTagLen: 16 },
  };

  const config = algoMap[algorithm] || enumAlgoMap[algorithm];
  
  if(!config) {
    throw new Exception(`Cannot create cipher for unknown algorithm '${algorithm}'`, 'ERR_CRYPTO_INVALID_ALGORITHM');
  }

  const requiredLen = config.keyLen + config.ivLen + (config.authTagLen || 0);

  if(superkey.byteLength < requiredLen) {
    throw new Exception(`The provided key is too short for '${algorithm}', expected at least ${requiredLen} bytes`, 'ERR_CRYPTO_SHORT_KEY');
  }

  const iv = superkey.subarray(0, config.ivLen);
  const key = superkey.subarray(config.ivLen, config.ivLen + config.keyLen);
  const authTag = config.authTagLen ? superkey.subarray(config.ivLen + config.keyLen, requiredLen) : undefined;

  return { iv, key, authTag };
}


export default crypto;
