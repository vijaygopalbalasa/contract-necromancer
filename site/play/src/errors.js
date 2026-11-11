// The only error type shown to users. Its message is one short plain sentence.
export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}
