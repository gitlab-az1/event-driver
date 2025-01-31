import { ILeft, IRight } from '@rapid-d-kit/types';


/**
 * Represents the Left side of an Either type, holding a value of type L.
 * 
 * @class Left
 * @template L - Type of the left value
 * @template A - Type of the right value
 */
export class Left<L, A> implements ILeft<L, A> {

  /**
   * Readonly property holding the left value.
   */
  public readonly value: L;

  /**
   * Constructor for the Left class.
   * 
   * @param value The value to be stored on the left side.
   */
  constructor(value: L) {
    this.value = value;
  }

  /**
   * Checks if the instance is of type Left.
   * 
   * @returns {boolean} True if the instance is Left, false otherwise.
   */
  public isLeft(): this is Left<L, A> {
    return true;
  }

  /**
   * Checks if the instance is of type Right.
   * 
   * @returns {boolean} False since this instance is of type Left.
   */
  public isRight(): this is Right<L, A> {
    return false;
  }
}


/**
 * Represents the Right side of an Either type, holding a value of type A.
 * 
 * @class Right
 * @template L - Type of the left value
 * @template A - Type of the right value
 */
export class Right<L, A> implements IRight<L, A> {

  /**
   * Readonly property holding the right value.
   */
  public readonly value: A;

  /**
   * Constructor for the Right class.
   * 
   * @param value The value to be stored on the right side.
   */
  constructor(value: A) {
    this.value = value;
  }

  /**
   * Checks if the instance is of type Left.
   * 
   * @returns {boolean} False since this instance is of type Right.
   */
  public isLeft(): this is Left<L, A> {
    return false;
  }

  /**
   * Checks if the instance is of type Right.
   * 
   * @returns {boolean} True if the instance is Right, false otherwise.
   */
  public isRight(): this is Right<L, A> {
    return true;
  }
}


/**
 * Either type representing either a Left or Right instance.
 * 
 * @template L - Type of the left value
 * @template A - Type of the right value
 */
export type Either<L, A> = Left<L, A> | Right<L, A>;


/**
 * Creates a Left instance with the specified left value.
 * 
 * @function left
 * @param {L} l - The left value to be stored in the Left instance.
 * @returns {Either<L, A>} Left instance containing the provided left value.
 */
export const left = <L, A>(l: L): Either<L, A> => {
  return new Left<L, A>(l);
};


/**
 * Creates a Right instance with the specified right value.
 * 
 * @function right
 * @param {A} a - The right value to be stored in the Right instance.
 * @returns {Either<L, A>} Right instance containing the provided right value.
 */
export const right = <L, A>(a: A): Either<L, A> => {
  return new Right<L, A>(a);
};
