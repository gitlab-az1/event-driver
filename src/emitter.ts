import { Disposable, IDisposable } from '@rapid-d-kit/disposable';
import type { Dict, LooseAutocomplete } from '@rapid-d-kit/types';
import { assertDefinedString, assertUnsignedInteger } from '@rapid-d-kit/safe';

import { AbstractEvent, IEvent } from './events';


type EventListener<T extends [unknown, unknown?]> = {
  callback: ((event: AbstractEvent<T[0], T[1]>) => unknown) | AbstractEvent<T[0], T[1]>;
  thisArgs?: any;
  once: boolean;
};

export type EmitterOptions = {
  maxListeners?: number;
};

export class EventEmitter<T extends Dict<[unknown, unknown?]> = Dict<[unknown, unknown?]>> extends Disposable {
  #state: number;
  #disposed: boolean;
  #maxListeners: number;
  readonly #listeners: Map<string, EventListener<T[keyof T]>[]>;

  public constructor(_options?: EmitterOptions) {
    super();

    this.#maxListeners = _options?.maxListeners || 32;
    assertUnsignedInteger(this.#maxListeners);

    this.#state = 0;
    this.#disposed = false;
    this.#listeners = new Map();
  }

  public setMaxListeners(value: number): this {
    if(this.#disposed) {
      throw void 0; // TODO !!
    }

    assertUnsignedInteger(value);
    this.#maxListeners = value;

    return this;
  }

  public addListener<K extends keyof T>(event: LooseAutocomplete<K>, callback: EventListener<T[K]>['callback'], thisArgs?: any, options?: { once?: boolean, disposables?: IDisposable[] }): this {
    if(this.#disposed) {
      throw void 0; // TODO !!
    }

    assertDefinedString(event);

    if(!this.#listeners.has(event)) {
      this.#listeners.set(event, []);
    }

    const prev = this.#listeners.get(event) || [];

    if(
      prev.some(item => {
        if(item.callback instanceof AbstractEvent) {
          if(callback instanceof AbstractEvent)
            return item.callback === callback;

          return item.callback.$inspect().callback === (callback as () => void);
        }

        if(callback instanceof AbstractEvent)
          return (item.callback as () => void) === callback.$inspect().callback;

        return item.callback === callback;
      })
    ) return this;

    if(prev.length >= this.#maxListeners) {
      throw void 0; // TODO !!
    }

    prev.push({
      callback,
      thisArgs,
      once: options?.once ?? false,
    });

    if(options?.disposables && Array.isArray(options.disposables)) {
      for(let i = 0; i < options.disposables.length; i++) {
        super._register(options.disposables[i]);
      }
    }

    return this;
  }

  public removeListener<K extends keyof T>(event: LooseAutocomplete<K>, callback: EventListener<T[K]>['callback']): boolean {
    if(this.#disposed) {
      throw void 0; // TODO !!
    }

    assertDefinedString(event);

    if(!this.#listeners.has(event))
      return false;

    const prev = this.#listeners.get(event) || [];
    const index = prev.findIndex(item => item.callback === callback);

    if(index < 0)
      return false;

    prev.splice(index, 1);
    return true;
  }

  public removeManyListeners(event: LooseAutocomplete<keyof T>): boolean {
    if(this.#disposed) {
      throw void 0; // TODO !!
    }

    assertDefinedString(event);

    return this.#listeners.delete(event);
  }

  public removeAllListeners(): this {
    if(this.#disposed) {
      throw void 0; // TODO !!
    }

    this.#listeners.clear();
    super.clear();

    this.#state++;
    return this;
  }

  public emit<K extends keyof T>(event: LooseAutocomplete<K>, payload: T[K][0], target?: T[K][1]): boolean;
  public emit(event: IEvent<T[keyof T][0], T[keyof T][1]>): boolean;
  public emit(event: string | IEvent<T[keyof T][0], T[keyof T][1]>, payload?: T[keyof T][0], target?: T[keyof T][1]): boolean {
    let en: string;
    let p: T[keyof T][0];
    let t: T[keyof T][1] | undefined = void 0;

    if(typeof event === 'string') {
      assertDefinedString(event);

      en = event;
      p = payload;
      t = target;
    } else {
      en = event.name;
      p = event.payload;
      t = event.target;
    }

    if(!this.#listeners.has(en))
      return false;

    const listeners = this.#listeners.get(en) || [];
    const deleteIndexes: number[] = [];

    for(let i = 0; i < listeners.length; i++) {
      const { callback, thisArgs, once } = listeners[i];
      let callable: AbstractEvent = callback as AbstractEvent;

      if(!(callback instanceof AbstractEvent)) {
        callable = new class extends AbstractEvent { }(en, callback as any, { once, thisArgs });
      }

      callable.dispatch(p, t);

      if(once) {
        deleteIndexes.push(i);
      }
    }

    if(deleteIndexes.length > 0) {
      this.#listeners.set(en, listeners.filter((_, i) => !deleteIndexes.includes(i)));
    }

    return true;
  }

  // public fire(event: LooseAutocomplete<keyof T> | IEvent<T[keyof T][0], T[keyof T][1]>): boolean { }

  public override dispose(): void {
    super.dispose();

    if(!this.#disposed) {
      this.#listeners.clear();
      this.#disposed = true;
      this.#state = -1;
    }
  }
}

export default EventEmitter;
