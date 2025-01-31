import { IOStream } from 'ndforge';
import { assertNumeric } from '@rapid-d-kit/safe';
import type { ErrorOptions } from 'ndforge/io/exceptions';
import type { LooseAutocomplete } from '@rapid-d-kit/types';


export enum ERROR_CODE {
  ERR_UNKNOWN_ERROR = 1001,
  ERR_RESOURCE_DISPOSED = 1002,
  ERR_INVALID_ARGUMENT = 1003,
  ERR_TOKEN_CANCELLED = 1004,
  ERR_ONCE_METHOD_CALLED_AGAIN = 1005,
  ERR_UNSUPPORTED_OPERATION = 1006,
  ERR_END_OF_STREAM = 1007,
  ERR_INVALID_TYPE = 1008,
  ERR_CRYPTO_INVALID_ALGORITHM = 1009,
  ERR_CRYPTO_SHORT_KEY = 1010,
  ERR_INVALID_SIGNATURE = 1011,
  ERR_TIMEOUT = 1012,
}


const extendedCodes: Record<string, number> = {};
const $codeHolder = Symbol('kErrorCode');


export class ErrorCode {
  public static extend<K extends string>(codes: readonly K[]): void {
    const maxValue = Math.max(
      ...Object.values(ERROR_CODE).filter(item => typeof item === 'number'),
      ...Object.values(extendedCodes) // eslint-disable-line comma-dangle
    );

    let validCount = 0;

    for(let i = 0; i < codes.length; i++) {
      const currentCode = codes[i].toUpperCase().trim();

      if(
        !!ERROR_CODE[currentCode as keyof typeof ERROR_CODE] ||
        !!extendedCodes[currentCode]
      ) continue;

      const absCode = maxValue + validCount + 1;
      extendedCodes[currentCode] = absCode;
      validCount++;
    }
  }

  public static for(code: LooseAutocomplete<keyof typeof ERROR_CODE>): ErrorCode {
    let ncode = ERROR_CODE[code as keyof typeof ERROR_CODE] || extendedCodes[code as string] || ERROR_CODE.ERR_UNKNOWN_ERROR;

    if(typeof ncode !== 'number') {
      ncode = ERROR_CODE.ERR_UNKNOWN_ERROR;
    }

    return new ErrorCode(ncode);
  }

  private readonly [$codeHolder]: number;

  private constructor(code: number) {
    assertNumeric(code);
    this[$codeHolder] = -Math.abs(code);
  }

  public getCode(): number {
    return this[$codeHolder];
  }

  public valueOf(): number {
    return this[$codeHolder];
  }
}


export class Exception extends IOStream.Exception.Throwable {
  public override readonly name: string;
  public override readonly description: string;

  public constructor(message: string, code: ERROR_CODE | keyof typeof ERROR_CODE, options?: Omit<ErrorOptions, 'code'>) {
    const errorCode = typeof code === 'number' ? Math.abs(code | 0) : ErrorCode.for(code).getCode();

    super(message, {
      ...options,
      code: -errorCode,
    });

    this.name = 'Exception';
    this.description = _describeErrorCode(errorCode);
  }
}


function _describeErrorCode(code: number): string {
  const errorDescriptions: Record<number, string> = {
    [ERROR_CODE.ERR_UNKNOWN_ERROR]: 'An unknown error occurred in some part of the code.',
    [ERROR_CODE.ERR_RESOURCE_DISPOSED]: 'Attempted to use a stream that has already been disposed of.',
  };

  return errorDescriptions[code] || errorDescriptions[ErrorCode.for('ERR_UNKNOWN_ERROR').getCode()];
}

export function errorDescription(err: Exception): string {
  return _describeErrorCode(err.code);
}


export default Exception;
