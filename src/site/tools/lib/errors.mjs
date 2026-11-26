/** A failure the CLI reports as `error: <message>` plus an optional `hint: <hint>`. */
export class SiteError extends Error {
  /**
   * @param {string} message What went wrong.
   * @param {{ hint?: string }} [options] What to do about it.
   */
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'SiteError';
    this.hint = hint;
  }
}
