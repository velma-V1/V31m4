export class BoundedScheduler {
  #active = 0;
  readonly #queue: Array<() => void> = [];
  constructor(private readonly concurrency: number) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1)
      throw new Error("Invalid concurrency");
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.#active++;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.#active--;
            this.#queue.shift()?.();
          });
      };
      if (this.#active < this.concurrency) start();
      else this.#queue.push(start);
    });
  }
}
