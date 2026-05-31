declare module '*sparse_matrix_wasm*' {
  export function init_wasm(threads: number): void;
  export function create_random_matrix(rows: number, cols: number, density: number): any;
  export function multiply_parallel(a: any, b: any): any;
  export function multiply_parallel_with_progress(a: any, b: any, callback: Function): any;
  export function multiply_sequential(a: any, b: any): any;
}
