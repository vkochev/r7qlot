declare module 'node:http' {
  const x: any;
  export default x;
}
declare module 'node:fs' {
  export const readFileSync: any;
}
declare module 'node:child_process' {
  export const spawn: any;
  export type ChildProcessWithoutNullStreams = any;
}
declare module 'node:crypto' {
  export const randomUUID: any;
}
declare module 'node:test' {
  const test: any;
  export default test;
}
declare module 'node:assert/strict' {
  const x: any;
  export default x;
}
declare var process: any;
declare var Buffer: any;
