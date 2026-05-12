type WithElementType<A extends readonly unknown[], T> = { [K in keyof A]: T };

/** Repeat an array 10 times */
type TimesTen<A extends any[]> = [...A, ...A, ...A, ...A, ...A, ...A, ...A, ...A, ...A, ...A];

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Map of decimal digit to array with length equal to the digit */
interface _SingleDigitArrayLength {
  0: [];
  1: [any];
  2: [any, any];
  3: [any, any, any];
  4: [any, any, any, any];
  5: [any, any, any, any, any];
  6: [any, any, any, any, any, any];
  7: [any, any, any, any, any, any, any];
  8: [any, any, any, any, any, any, any, any];
  9: [any, any, any, any, any, any, any, any, any];
}

type _ArrayOfExactLength<N extends string, Pre extends any[]> =
  // If there's at least one digit, multiply `Pre` by ten and add the digit:
  `${N}` extends `${infer Hi extends Digit}${infer Lo}` ?
    _ArrayOfExactLength<Lo, [...TimesTen<Pre>, ..._SingleDigitArrayLength[Hi]]>
  : // Otherwise, return `Pre`
    Pre;

type _NaturalNumber<N extends number, S extends string = `${N}`> =
  // It starts with a hyphen so it's negative
  S extends `-${string}` ? 0
  : // It has a dot so it's not an integer
  S extends `${string}.${string}` ? number
  : N;

/**
 * If `N` is a natural number, evaluates to `N`.
 * If `N` is negative, evaluates to `0`.
 * Otherwise, evaluates to `number`.
 */
type NaturalNumber<N extends number> = _NaturalNumber<N>;

export type _ArrayOfLength<N extends number, T> =
  number extends N ? T[] : WithElementType<_ArrayOfExactLength<`${N}`, []>, T>;

/**
 * An array of length `N` with elements of type `T`.
 * If `N` is negative, evaluates to an empty tuple.
 * If `N` is not an integer, evaluates to `T[]`.
 */
export type ArrayOfLength<N extends number, T = any> =
  N extends never ? never : _ArrayOfLength<NaturalNumber<N>, T>;

export class Deque<T> implements Iterable<T> {
  /** The buffer for the circular queue */
  #data: Array<T | undefined>;

  /** The number of items in the deque. This must be less than or equal to `data.length`. */
  #size = 0;

  /**
   * The index within `data` of the first element.
   * This must be at least `0` and less than `data.length` (unless `data.length` is `0`).
   */
  #front = 0;

  /**
   * Keep a count of the number of active iterators.
   * Each mutating operation calls `cow()` first, which copies the entire deque if there are any
   * active iterators.
   *
   * An active iterator is one that has had `next()` called at least once and has not finished or
   * been cancelled with `return()` or `throw()`.
   * If a copy is made, this is replaced with a new object with a count of `0` so that existing
   * iterators are no longer considered.
   *
   */
  #iterators = { count: 0 };

  constructor(values?: Iterable<T>) {
    this.#data = values ? Array.from(values) : [];
  }

  /** Returns an iterator of all items in the deque. */
  *values(): IteratorObject<T, undefined, unknown> {
    const iters = this.#iterators;
    const data = this.#data;
    const size = this.#size;

    try {
      ++iters.count;

      for (let i = 0; i < size; i++) {
        yield data[i % data.length]!;
      }
    } finally {
      --iters.count;
    }
  }

  /**
   * Returns an iterator of the indices of all items in the deque.
   * In other words, yields integers in `[0, this.size)`.
   */
  keys(): IteratorObject<number, undefined, unknown> {
    return Array.prototype.keys.call({ length: this.#size });
  }

  /** Returns an iterator of pairs of item index and item value for all items in the deque. */
  *entries(): IteratorObject<[number, T], undefined, unknown> {
    const iters = this.#iterators;
    const data = this.#data;
    const size = this.#size;

    try {
      ++iters.count;

      for (let i = 0; i < size; i++) {
        yield [i, data[i % data.length]!];
      }
    } finally {
      --iters.count;
    }
  }

  [Symbol.iterator]() {
    return this.values();
  }

  /**
   * Each time the iterator is advanced, shifts one element from the front.
   * Terminates when the dequeue is empty.
   */
  *drain(): IteratorObject<T, undefined, unknown> {
    while (this.#size) {
      yield this.shift()!;
    }
  }

  /**
   * Each time the iterator is advanced, pops one element from the back.
   * Terminates when the dequeue is empty.
   */
  *drainReversed(): IteratorObject<T, undefined, unknown> {
    while (this.#size) {
      yield this.pop()!;
    }
  }

  /** The number of items in the deque. */
  get size() {
    return this.#size;
  }

  /**
   * If the buffer size is at least 16 or `size` is at least one fourth of `data.length`, does nothing.
   * Otherwise, divides the buffer size by two until `size` is at least one fourth of `data.length`.
   */
  #resizeDown() {
    const size = this.#size;
    const data = this.#data;
    const oldLength = data.length;

    if (oldLength <= 16 || size << 2 >= oldLength) return;

    const front = this.#front;
    let newLength = oldLength >> 1;

    while (size << 2 >= newLength) {
      newLength >>= 1;
    }

    const back = front + size;

    if (back <= newLength) {
      // Before:
      // [..1234..|........]
      //    │   │  └ newLength
      //    │   └ back
      //    └ front
      //
      // After:
      // [..1234..]
      //    │   └ back
      //    └ front
      data.length = newLength;
      return;
    }

    if (back > oldLength) {
      // Before:
      // [34......|......12]
      //           │     │    └ back
      //           │     └ front
      //           └ newLength
      // After:
      // [34....12]
      //        └ front
      const newFront = (this.#front = newLength - back + oldLength);

      data.copyWithin(newFront, front, oldLength);
      data.length = newLength;
      return;
    }

    if (front >= newLength) {
      // Before:
      // [........|..1234..]
      //           │ │   └ back
      //           │ └ front
      //           └ newLength
      //
      // After:
      // [1234....]
      //  └ front
      this.#front = 0;

      data.copyWithin(0, front, back);
      data.length = newLength;
      return;
    }

    // Before:
    // [......12|34......]
    //        │  │ └ back
    //        │  └ newLength
    //        └ front
    //
    // After:
    // [34....12]
    //        └ front
    data.copyWithin(0, newLength, back);
    data.length = newLength;
  }

  /** While adding `addHint` items would exceed the buffer size, doubles the buffer size. */
  #resizeUp(addHint = 1) {
    const size = this.#size;
    const data = this.#data;
    const oldLength = data.length;

    if (size === 0) {
      data.length = 8;
      return;
    }

    const hintSize = Math.max(size + addHint, 4);

    if (hintSize <= data.length) return;

    let newLength = data.length << 1;

    while (hintSize > newLength) {
      newLength <<= 1;
    }

    const front = this.#front;

    if (front === 0) {
      // Before:
      // [1234]
      //  └ front

      //
      // After:
      // [1234|....]
      //  │    └ oldLength
      //  └ front
      data.length = newLength;
      return;
    }

    // Before:
    // [3412]
    //    └ front
    //
    // After:
    // [34..|..12]
    //       │ └ front
    //       └ oldLength
    const newFront = (this.#front = front + (newLength - oldLength));

    data.length = newLength;
    data.copyWithin(newFront, front);
  }

  /**
   * copy-on-write
   *
   * copy this.#data if there are any iterators currently using it.
   */
  #cow() {
    if (this.#iterators.count) {
      this.#data = this.#data.slice();
      // Create a new iterator count object so none of the currently active iterators have an effect
      // on the count:
      this.#iterators = { count: 0 };
    }
  }

  /**
   * If the deque is not empty, removes and returns the first item.
   * Otherwise, returns `undefined`.
   */
  shift(): T | undefined {
    if (this.#size === 0) return undefined;
    this.#cow();
    const front = this.#front;
    const data = this.#data;
    --this.#size;
    const out = data[front];
    this.#front = (front + 1) % data.length;

    this.#resizeDown();
    return out;
  }

  /**
   * If the deque is not empty, removes and returns the last item.
   * Otherwise, returns `undefined`.
   */
  pop(): T | undefined {
    if (this.#size === 0) return undefined;
    this.#cow();
    const front = this.#front;
    const data = this.#data;
    const back = (front + this.#size--) % data.length;

    const out = data[back];
    this.#resizeDown();
    return out;
  }

  /**
   * If the deque has at least `n` elements, removes the first `n` elements and returns an array
   * with the removed elements.
   * Otherwise, returns `undefined` and leaves the deque unchanged.
   */
  shiftN<const N extends number>(n: N): ArrayOfLength<N, T> | undefined {
    type X = ArrayOfLength<-1, 0>;
    if (n <= 0) return [] as T[] as ArrayOfLength<N, T>;
    if (this.#size < n) return undefined;

    // This operation will mutate the deque so call `cow()` first
    this.#cow();

    const front = this.#front;
    const data = this.#data;

    // Start with a "hypothetical" back index.
    // At this point it may be greater than `data.length`
    let sliceBack = front + n;

    let out: Array<T | undefined>;

    if (sliceBack <= data.length) {
      // Example (n=4)
      //
      // Before:
      // [78........123456]
      //            │   └ sliceBack
      //            └ front
      //
      // After:
      // [78............56]
      //                └ front

      // The elements to be removed are contiguous, so we only need one slice.
      out = data.slice(front, sliceBack);

      // Write `undefined` over the removed elements:
      data.fill(undefined, front, sliceBack);
    } else {
      sliceBack -= this.#data.length;

      // Example (n=4)
      //
      // Before:
      // [345678........12]
      //    │           └ front
      //    └ sliceBack
      //
      // After:
      // [..5678..........]
      //    │
      //    └ front

      // The first part is from `front` to the end of the array.
      // Start with a slice of those elements:
      out = data.slice(front);

      // Write `undefined` over the removed elements from `front` to the end of the array:
      data.fill(undefined, front);
      const initialSliceLength = out.length;

      // The remaining part is from the start of the array to `sliceBack`.
      // Add those elements to the slice:
      out.length = n;
      for (let i = 0; i < sliceBack; ++i) {
        out[initialSliceLength + i] = data[i];
      }

      // Write `undefined` over the removed elements from the start of the array to `sliceBack`:
      data.fill(undefined, 0, sliceBack);
    }

    this.#size -= n;

    // Move `front` forward by `n` to account for the removed elements:
    this.#front = (this.#front + n) % data.length;

    // Since the size has changed, resize the buffer if needed:
    this.#resizeDown();
    return out as ArrayOfLength<N, T>;
  }

  /**
   * If the deque has at least `n` elements, removes the last `n` elements and returns an array
   * with the removed elements.
   * Otherwise, returns `undefined` and leaves the deque unchanged.
   */
  popN<const N extends number>(n: N): ArrayOfLength<N, T> | undefined {
    if (n <= 0) return [] as T[] as ArrayOfLength<N, T>;
    if (this.#size < n) return undefined;

    // This operation will mutate the deque so call `cow()` first
    this.#cow();

    const front = this.#front;
    const data = this.#data;

    // Start with a "hypothetical" back index.
    // At this point it may be greater than `data.length`
    let back = front + this.#size;

    // This is always nonnegative because `this.#size` is already known to be at least `n`
    // At this point it also may be greater than `data.length`
    let sliceFront = back - n;

    let out: Array<T | undefined>;

    if (sliceFront >= data.length) {
      // Adjust the indices so they fit in the buffer:
      sliceFront -= data.length;
      back -= data.length;

      // Example (n=4)
      //
      // Before:
      // [345678........12]
      //    │   │       └ front
      //    │   └ back
      //    └ sliceFront
      //
      // After
      // [34............12]
      //    │           └ sliceFront
      //    └ back

      // The elements to be removed are contiguous, so we only need one slice.
      out = data.slice(sliceFront, back);
      data.fill(undefined, sliceFront, back);
    } else if (back > data.length) {
      // Adjust the `back` index so it fits in the buffer:
      back -= data.length;

      // Example (n=4)
      //
      // Before:
      // [78........123456]
      //    │       │   └ sliceFront
      //    │       └ front
      //    └ back
      //
      // After:
      // [..........1234..]
      //            │   └ back
      //            └ front

      // The first part is from `sliceFront` to the end of the array.
      // Start with a slice of those elements:
      out = data.slice(sliceFront);

      // Write `undefined` over the removed elements from `sliceFront` to the end of the array:
      data.fill(undefined, sliceFront);
      const initialSliceLength = out.length;
      out.length = n;

      // The remaining part is from the start of the array to `back`.
      // Add those elements to the slice:
      for (let i = 0; i < back; ++i) {
        out[initialSliceLength + i] = data[i];
      }

      // Write `undefined` over the removed elements from the start of the array to `back`:
      data.fill(undefined, 0, back);
    } else {
      // Example (n=4)
      //
      // Before:
      // [..12345678......]
      //    │       └ back
      //    └ front
      //
      // After:
      // [..1234..........]
      //    │   └ back
      //    └ front

      // The elements to be removed are contiguous, so we only need one slice.
      out = data.slice(sliceFront, back);

      // Write `undefined` over the removed elements:
      data.fill(undefined, front, back);
    }

    this.#size -= n;

    // Since the size has changed, resize the buffer if needed:
    this.#resizeDown();
    return out as ArrayOfLength<N, T>;
  }

  push(...values: T[]): void {
    if (values.length === 0) return;
    this.#cow();
    this.#resizeUp(values.length);
    const front = this.#front;
    const data = this.#data;

    let i = front + this.#size;

    for (const item of values) {
      data[i++ % data.length] = item;
    }

    this.#size += values.length;
  }

  unshift(...values: T[]): void {
    if (values.length === 0) return;
    this.#cow();
    this.#resizeUp(values.length);
    const front = this.#front;
    const data = this.#data;

    let i = (this.#front = (front + data.length - values.length) % data.length);

    for (const item of values) {
      data[i++ % data.length] = item;
    }

    this.#size += values.length;
  }

  /**
   * Attempts to get the item at the given index.
   * If the index is negative, counts from the end of the deque.
   * If the index is out of bounds, returns `undefined`.
   */
  at(index: number): T | undefined {
    if (index < -this.#size) return;
    if (index < 0) {
      index += this.#size;
    }

    if (index >= 0 && index < this.#size) {
      const i = (this.#front + index) % this.#size;
      return this.#data[i];
    }

    return undefined;
  }

  /**
   * Attempts to set the item at the given index to the given value.
   * If the index is negative, counts from the end of the deque.
   * If the index is out of bounds, does nothing.
   */
  set(index: number, value: T): void {
    if (index < -this.#size) return;
    if (index < 0) {
      index += this.#size;
    }

    if (index >= 0 && index < this.#size) {
      const i = (this.#front + index) % this.#size;
      if (this.#data[i] === value) return;
      this.#cow();
      this.#data[i] = value;
    }
  }

  /** Removes all elements from the deque. */
  clear(): void {
    if (this.#size !== 0 && this.#iterators.count) {
      // Skip calling `cow()` because we don't need to do a full copy since we're just clearing everything.
      // Instead, replace the buffer with an empty array and create a new iterator count object.
      this.#data = [];
      this.#iterators = { count: 0 };
    } else {
      // Set the buffer length to zero to clear it.
      this.#data.length = 0;
    }

    this.#size = this.#front = 0;
  }
}
