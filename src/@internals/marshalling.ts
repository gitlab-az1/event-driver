import { type Dict } from 'ndforge';

import { Exception } from './errors';


// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Marshalling {
  export const enum MarshalledId {
    Binary,
    String,
    Integer,
    Decimal,
    Boolean,
    Null,
    Object,
    Array,
    Symbol,
    Date,
  }

  export type MarshallObject = (
    | { $mid: MarshalledId.Binary; value: string }
    | { $mid: MarshalledId.String; value: string }
    | { $mid: MarshalledId.Integer; value: number }
    | { $mid: MarshalledId.Decimal; value: number }
    | { $mid: MarshalledId.Boolean; value: boolean }
    | { $mid: MarshalledId.Null }
    | { $mid: MarshalledId.Object; value: Dict<MarshallObject> }
    | { $mid: MarshalledId.Array; value: MarshallObject[] }
    | { $mid: MarshalledId.Date; value: string; }
  );

  export type InferRuntimeValue<T extends MarshallObject> = (
    T extends { $mid: MarshalledId.Binary } ? Buffer :
    T extends { $mid: MarshalledId.String } ? string :
    T extends { $mid: MarshalledId.Integer } ? number :
    T extends { $mid: MarshalledId.Decimal } ? number :
    T extends { $mid: MarshalledId.Boolean } ? boolean :
    T extends { $mid: MarshalledId.Null } ? null :
    T extends { $mid: MarshalledId.Date } ? Date :
    T extends { $mid: MarshalledId.Object; value: infer O extends Dict<MarshallObject> } ? { [K in keyof O]: InferRuntimeValue<O[K]> } :
    T extends { $mid: MarshalledId.Array; value: infer A extends MarshallObject[] } ? InferRuntimeValue<A[number]>[] :
    never
  );

  export function isMarshallObject(arg: unknown): arg is MarshallObject {
    return (
      typeof arg === 'object' &&
      !!arg &&
      typeof (<any>arg)['$mid'] === 'number'
    );
  }

  export function parse<T = unknown>(value: unknown): T | undefined {
    if(!isMarshallObject(value)) return void 0;
    return revive(value) as T;
  }

  export function revive<O extends MarshallObject>(object: O): InferRuntimeValue<O> {
    if(!isMarshallObject(object)) {
      throw new Exception('Cannot revive a non-marshalled object', 'ERR_UNSUPPORTED_OPERATION');
    }

    switch (object.$mid) {
      case MarshalledId.Binary:
        return Buffer.from(object.value, 'base64') as any;
      case MarshalledId.String:
        return object.value as any;
      case MarshalledId.Integer:
        return object.value as any;
      case MarshalledId.Decimal:
        return object.value as any;
      case MarshalledId.Boolean:
        return object.value as any;
      case MarshalledId.Null:
        return null as any;
      case MarshalledId.Date: {
        const d = new Date(object.value);

        if(isNaN(d.getTime())) {
          throw new Exception(`Failed to parse invalid marshalled date '${object.value}'`, 'ERR_INVALID_TYPE');
        }

        return d as any;
      }
      case MarshalledId.Object:
        return Object.fromEntries( Object.entries(object.value).map(([key, val]) => [key, revive(val)]) ) as any;
      case MarshalledId.Array:
        return object.value.map(revive) as any;
      default:
        throw new Exception(`Unknown or unsupported marshall type (${(<any>object).$mid})`, 'ERR_INVALID_TYPE');
    }
  }

  export function encode(value: unknown): MarshallObject {
    if(Buffer.isBuffer(value) || value instanceof Uint8Array)
      return {
        $mid: MarshalledId.Binary,
        value: (Buffer.isBuffer(value) ? value : Buffer.from(value)).toString('base64'),
      };

    if(value instanceof Date) return {
      $mid: MarshalledId.Date,
      value: value.toISOString(),
    };

    // Handle primitive types
    switch(typeof value) {
      case 'string':
        return { $mid: MarshalledId.String, value };
      case 'number':
        return Number.isInteger(value)
          ? { $mid: MarshalledId.Integer, value }
          : { $mid: MarshalledId.Decimal, value };
      case 'boolean':
        return { $mid: MarshalledId.Boolean, value };
      case 'object':
        if (value === null) return { $mid: MarshalledId.Null };
        if (Array.isArray(value))
          return { $mid: MarshalledId.Array, value: value.map(encode) };
        return {
          $mid: MarshalledId.Object,
          value: encodeObjectValues(value as Dict<unknown>),
        };
      default:
        throw new Exception('Unsupported value type for encoding', 'ERR_INVALID_TYPE');
    }
  }

  export function encodeObjectValues<K extends string | number | symbol, T extends Record<K, unknown>>(obj: T): K extends string ? { [TKey in keyof T]: MarshallObject } : Dict<MarshallObject> {
    return Object.fromEntries( Object.entries(obj).map(([key, value]) => [key.toString(), encode(value)]) ) as any;
  }

  export function jsonReviver(_: string, value: any) {
    if(Array.isArray(value)) return value.map(item => {
      if(!isMarshallObject(item)) return item;

      try {
        return revive(item);
      } catch {
        return item;
      }
    });

    if(!isMarshallObject(value)) return value;

    try {
      return revive(value);
    } catch {
      return value;
    }
  }

  export function tryRevive<T = unknown>(value: any): T {
    try {
      if(Array.isArray(value)) return value.map(revive) as T;
      return revive(value) as T;
    } catch {
      return value;
    }
  }
}

export default Marshalling;
