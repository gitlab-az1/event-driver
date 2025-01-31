import { assertUnsignedInteger } from '@rapid-d-kit/safe';
import { jsonSafeParser, jsonSafeStringify, option } from 'ndforge';

import { bitwise } from './@internals/bitwise';
import { Exception } from './@internals/errors';
import Marshalling from './@internals/marshalling';


export interface IWriter {
  write(data: Buffer): void;
  drain(): Buffer;
}

export interface IReader {
  read(byteLength?: number): Buffer;
  readonly readable: boolean;
}


export class BufferReader implements IReader {
  #cursor: number = 0;
  readonly #buffer: Buffer;

  public constructor( _buffer: Buffer ) {
    if(!Buffer.isBuffer(_buffer)) {
      throw new Exception(`Cannot create a reader from a non-buffer argument 'typeof ${typeof _buffer}'`, 'ERR_INVALID_ARGUMENT');
    }

    this.#buffer = _buffer;
  }

  public get byteLength(): number {
    return this.#buffer.byteLength - this.#cursor;
  }

  public read(bytes?: number): Buffer {
    if(this.#cursor >= this.#buffer.byteLength) {
      throw new Exception('The buffer has already been completely consumed', 'ERR_END_OF_STREAM');
    }

    if(typeof bytes !== 'number') {
      this.#cursor = this.#buffer.byteLength;
      return this.#buffer.subarray(0);
    }

    assertUnsignedInteger(bytes);
    const chunk = this.#buffer.subarray(this.#cursor, this.#cursor + bytes);

    this.#cursor += chunk.byteLength;
    return chunk;
  }

  public get readable(): boolean {
    return this.#cursor < this.#buffer.byteLength;
  }
}

export class BufferWriter implements IWriter {
  #buffers: Buffer[] = [];

  public get buffer(): Buffer {
    return Buffer.concat(this.#buffers);
  }

  public write(chunk: Buffer): void {
    this.#buffers.push(chunk);
  }

  public drain(): Buffer {
    const result = Buffer.concat(this.#buffers);
    this.#buffers = [];

    return result;
  }
}


export const enum SerializableDataType {
  Null = 0,
  String = 1,
  Uint = 2,
  Object = 3,
  Array = 4,
  MarshallObject = 5,
  Buffer = 6,
}

export function createOneByteBuffer(value: number): Buffer {
  const result = Buffer.alloc(1);
  result.writeUInt8(value, 0);

  return result;
}

const BufferPresets: { readonly [K in keyof typeof SerializableDataType]: Buffer } = {
  Null: createOneByteBuffer(SerializableDataType.Null),
  String: createOneByteBuffer(SerializableDataType.String),
  Buffer: createOneByteBuffer(SerializableDataType.Buffer),
  Array: createOneByteBuffer(SerializableDataType.Array),
  Object: createOneByteBuffer(SerializableDataType.Object),
  Uint: createOneByteBuffer(SerializableDataType.Uint),
  MarshallObject: createOneByteBuffer(SerializableDataType.MarshallObject),
};


export function readIntVQL(reader: IReader): number {
  let value = 0;

  for(let n = 0; ; n += 7) {
    const next = reader.read(1);
    value |= (next[0] & 0b01111111) << n;

    if(!(next[0] & 0b10000000))
      return value;
  }
}

const vqlZero = createOneByteBuffer(0);

export function writeInt32VQL(writer: IWriter, value: number) {
  if(value === 0) return writer.write(vqlZero);

  let len = 0;

  for(let v2 = value; v2 !== 0; v2 = v2 >>> 7) {
    len++;
  }

  const scratch = Buffer.alloc(len);

  for(let i = 0; value !== 0; i++) {
    scratch[i] = value & 0b01111111;
    value = value >>> 7;

    if(value > 0) {
      scratch[i] |= 0b10000000;
    }
  }

  writer.write(scratch);
}


export function serialize(writer: IWriter, data: unknown): void {
  // Case A:
  if(data === null || typeof data === 'undefined') {
    // The data is null or not defined
    writer.write(BufferPresets.Null);

    // Case B:
  } else if(typeof data === 'string') {
    // The data is a string
    const buffer = Buffer.from(data);

    writer.write(BufferPresets.String);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);

    // Case C:
  } else if(data instanceof Uint8Array || Buffer.isBuffer(data)) {
    // The data is binary, either a Buffer or raw Uint8Array instance
    if(!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    writer.write(BufferPresets.Buffer);
    writeInt32VQL(writer, (data as Buffer).byteLength);
    writer.write(data as Buffer);

    // Case D:
  } else if(typeof data === 'number' && bitwise.or(data, 0) === data) {
    // The data is a number that allows bitwise operations (will be a unsigned integer)
    writer.write(BufferPresets.Uint);
    writeInt32VQL(writer, data);

    // Case E:
  } else if(Array.isArray(data)) {
    // The data is an array of unknown elements
    writer.write(BufferPresets.Array);
    writeInt32VQL(writer, data.length);

    for(let i = 0; i < data.length; i++) {
      serialize(writer, data[i]);
    }

    // Case F:
  } else if(Marshalling.isMarshallObject(data)) {
    // The data is a marshalled object
    const buffer = Buffer.from( option(jsonSafeStringify(data)).unwrap() );

    writer.write(BufferPresets.MarshallObject);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);

    // Case G:
  } else {
    // The data is not of a known type (will be serialized as JSON)
    const buffer = Buffer.from( option(jsonSafeStringify(data)).unwrap() );

    writer.write(BufferPresets.Object);
    writeInt32VQL(writer, buffer.byteLength);
    writer.write(buffer);
  }
}

export function deserialize<T = any>(reader: IReader): T {
  const dataType = reader.read(1).readUint8(0);

  switch(dataType) {
    // Case A: The data is null or not defined
    case SerializableDataType.Null:
      return null as T;

    // Case B: The data is a string
    case SerializableDataType.String:
      return reader.read(readIntVQL(reader)).toString() as T;

    // Case C: The data is a unsigned integer
    case SerializableDataType.Uint:
      return readIntVQL(reader) as T;

    // Case D: The data is a binary buffer
    case SerializableDataType.Buffer:
      return reader.read(readIntVQL(reader)) as T;

    // Case E: The data is an array of unknown elements
    case SerializableDataType.Array: {
      const len = readIntVQL(reader);
      const result: unknown[] = [];

      for(let i = 0; i < len; i++) {
        result.push(deserialize(reader));
      }

      return result as T;
    }

    // Case F: The data is a marshalled object
    case SerializableDataType.MarshallObject: {
      const parsed = jsonSafeParser<Marshalling.MarshallObject>(reader.read(readIntVQL(reader)).toString());

      if(parsed.isLeft()) {
        throw parsed.value;
      }

      return Marshalling.revive(parsed.value) as T;
    }

    // Case G: The data is not of a known type (parse as JSON)
    case SerializableDataType.Object: {
      const parsed = jsonSafeParser<T>(reader.read(readIntVQL(reader)).toString());

      if(parsed.isLeft()) {
        throw parsed.value;
      }

      return parsed.value;
    }

    // Case H (default): The buffer is not serialized
    default:
      throw new Exception(`Cannot deserialize a unknown data buffer (0x${dataType.toString(16).toUpperCase()})`, 'ERR_UNSUPPORTED_OPERATION');
  }
}

