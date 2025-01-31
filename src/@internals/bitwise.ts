/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable no-inner-declarations */


export namespace bitwise {
  export function and(x: number, y: number): number {
    return x & y;
  }

  export function or(x: number, y: number): number {
    return x | y;
  }

  export function xor(x: number, y: number): number {
    return x ^ y;
  }

  export function not(x: number): number {
    return ~x;
  }

  export function leftShift(x: number, count: number): number {
    return x << count;
  }

  export function rightShift(x: number, count: number): number {
    return x >> count;
  }

  export function leftShiftWithCount(x: number, y: number, count: number): number {
    return leftShift(x, count) | leftShift(y, count);
  }

  export function rightShiftWithCount(x: number, y: number, count: number): number {
    return rightShift(x, count) & rightShift(y, count);
  }
}


export default bitwise;
