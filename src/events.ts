import { isThenable } from 'ndforge';
import { timestamp } from 'ndforge/timer';
import { assert } from '@rapid-d-kit/safe';
import { Disposable, IDisposable } from '@rapid-d-kit/disposable';
import { CancellationTokenSource, ICancellationToken } from '@rapid-d-kit/async';

import { IInspectable } from './@internals/inspect';


export type EventOptions = {
  cancellable?: boolean;
  thisArgs?: any;
  once?: boolean;
}

export interface IEvent<P, T> {
  readonly name: string;
  readonly payload: P;
  readonly target: T;
  readonly timestamp: number;
}

export type EventCallback<P = unknown, T = unknown, R = unknown> = (event: IEvent<P, T>, token: ICancellationToken) => R;
export type EventStatus = 'pending' | 'dispatched' | 'canceled' | 'disposed';


type EventState = {
  cancellable: boolean;
  canceled: boolean;
  disposed: boolean;
  calls: number;
};

export abstract class AbstractEvent<TPayload = unknown, TTarget = unknown, TReturn = unknown> extends Disposable implements IDisposable, IInspectable<{ callback: EventCallback<TPayload, TTarget, TReturn> }> {
  readonly #callback: EventCallback<TPayload, TTarget, TReturn>;
  readonly #state: EventState;
  readonly #name: string;
  
  readonly #once: boolean;
  readonly #thisArgs?: any;

  #results: Awaited<TReturn>[];
  #source: CancellationTokenSource;

  public constructor(_name: string, _callback: EventCallback<TPayload, TTarget, TReturn>, _options?: EventOptions) {
    assert(typeof _callback === 'function');
    super();

    this.#name = _name;
    this.#callback = _callback;
    this.#source = new CancellationTokenSource();

    this.#state = {
      cancellable: _options?.cancellable ?? false,
      canceled: false,
      disposed: false,
      calls: 0,
    };

    this.#results = [];
    this.#once = _options?.once ?? false;
    this.#thisArgs = _options?.thisArgs || null;
  }

  public get name(): string {
    return this.#name.slice(0);
  }

  public results(): readonly Awaited<TReturn>[] {
    return Object.freeze([ ...this.#results ]);
  }

  public cancellable(): boolean {
    return this.#state.cancellable;
  }

  public status(): EventStatus {
    if(this.#state.disposed)
      return 'disposed';

    if(this.#state.canceled)
      return 'canceled';

    return this.#state.calls === 0 ? 'pending' : 'dispatched';
  }

  public dispatch(payload: TPayload, target: TTarget): void {
    if(this.#once && this.#state.calls > 0)
      return;

    if(this.#state.disposed)
      return;

    if(!this.#thisArgs) {
      const result = this.#callback({
        payload,
        target,
        timestamp: timestamp(),
        name: this.#name.slice(0),
      }, this.#source.token);

      if(isThenable(result)) {
        result.then(value => void this.#results.push(value as Awaited<TReturn>));
      } else {
        this.#results.push(result as Awaited<TReturn>);
      }
    } else {
      const result = this.#callback.call(this.#thisArgs, {
        payload,
        target,
        timestamp: timestamp(),
        name: this.#name.slice(0),
      }, this.#source.token);

      if(isThenable(result)) {
        result.then(value => void this.#results.push(value as Awaited<TReturn>));
      } else {
        this.#results.push(result as Awaited<TReturn>);
      }
    }

    this.#state.calls++;
  }

  public cancel(reason?: any): void {
    if(!this.#state.cancellable)
      return;

    this.#source.cancel(reason);
    this.#state.canceled = true;

    this.#source = new CancellationTokenSource();
  }

  public $inspect() {
    return {
      callback: this.#callback,
    };
  }

  public dispose(): void {
    super.dispose();

    if(this.#state.disposed)
      return;

    this.cancel();
    this.#source.cancel();

    this.#results = [];
    this.#state.disposed = true;
  }
}
