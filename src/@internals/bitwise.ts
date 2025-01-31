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
}


export default bitwise;
