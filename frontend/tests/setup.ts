beforeEach(() => {
  globalThis.fetch = (() => {
    return Promise.reject(new Error("Unmocked network fetch is forbidden in unit tests"));
  }) as typeof fetch;
});
