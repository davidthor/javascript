// NOTE: This isn't ideal. But, *for the time being*, I'm trying
// not to introduce changes or new functionality to `clerk-js`.
export async function waitForLoaded(
  cb: () => boolean,
  opts?: { interval: number; maxAttempts: number },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const { interval = 50, maxAttempts = 100 } = opts || {};

    let currentAttempt = 0;

    const timer = setInterval(() => {
      if (currentAttempt >= maxAttempts) {
        clearInterval(timer);
        reject('Failed to load.');
      }

      if (cb()) {
        clearInterval(timer);
        resolve();
      }

      currentAttempt++;
    }, interval);
  });
}
