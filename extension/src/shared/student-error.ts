/**
 * An error whose message is written for the student, per docs/design/copy.md,
 * so the panel may show it as is. Any other error is internal: the panel shows
 * fixed copy instead of its message.
 */
export class StudentError extends Error { }
