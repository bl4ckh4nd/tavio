export const makeAuth = (subject?: string) => ({
  getUserIdentity: async () => (subject ? { subject } : null),
});

export const asHandler = <T extends { _handler: (...args: any[]) => any }>(fn: T) => fn._handler;
