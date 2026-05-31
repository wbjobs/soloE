mod csr;
mod multiply;

pub use csr::CSRMatrix;
pub use multiply::{multiply_parallel_raw, get_result_matrix, free_result_matrix};

use wasm_bindgen::prelude::*;
use wasm_bindgen_rayon::init_thread_pool;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn init_wasm(threads: usize) {
    init_thread_pool(threads);
}

#[wasm_bindgen]
pub fn create_random_matrix(rows: usize, cols: usize, density: f64) -> *mut u8 {
    let matrix = CSRMatrix::random_sparse(rows, cols, density);
    Box::into_raw(Box::new(matrix)) as *mut u8
}
