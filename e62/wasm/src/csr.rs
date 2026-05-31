use wasm_bindgen::prelude::*;
use std::mem;

#[wasm_bindgen]
pub struct CSRMatrix {
    rows: usize,
    cols: usize,
    indptr: Vec<u32>,
    indices: Vec<u32>,
    data: Vec<f64>,
}

#[wasm_bindgen]
impl CSRMatrix {
    #[wasm_bindgen(constructor)]
    pub fn new(rows: usize, cols: usize) -> Self {
        CSRMatrix {
            rows,
            cols,
            indptr: vec![0; rows + 1],
            indices: Vec::new(),
            data: Vec::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.rows
    }

    #[wasm_bindgen(getter)]
    pub fn cols(&self) -> usize {
        self.cols
    }

    #[wasm_bindgen(getter)]
    pub fn nnz(&self) -> usize {
        self.data.len()
    }

    pub fn indptr_ptr(&self) -> *const u32 {
        self.indptr.as_ptr()
    }

    pub fn indices_ptr(&self) -> *const u32 {
        self.indices.as_ptr()
    }

    pub fn data_ptr(&self) -> *const f64 {
        self.data.as_ptr()
    }

    pub fn indptr_len(&self) -> usize {
        self.indptr.len()
    }

    pub fn indices_len(&self) -> usize {
        self.indices.len()
    }

    pub fn data_len(&self) -> usize {
        self.data.len()
    }

    pub unsafe fn from_raw_parts(
        rows: usize,
        cols: usize,
        indptr_ptr: *const u32,
        indptr_len: usize,
        indices_ptr: *const u32,
        indices_len: usize,
        data_ptr: *const f64,
        data_len: usize,
    ) -> Self {
        let indptr = Vec::from_raw_parts(indptr_ptr as *mut u32, indptr_len, indptr_len);
        let indices = Vec::from_raw_parts(indices_ptr as *mut u32, indices_len, indices_len);
        let data = Vec::from_raw_parts(data_ptr as *mut f64, data_len, data_len);

        CSRMatrix {
            rows,
            cols,
            indptr,
            indices,
            data,
        }
    }

    pub fn into_raw_parts(self) -> (usize, usize, *const u32, usize, *const u32, usize, *const f64, usize) {
        let rows = self.rows;
        let cols = self.cols;
        let indptr_ptr = self.indptr.as_ptr();
        let indptr_len = self.indptr.len();
        let indices_ptr = self.indices.as_ptr();
        let indices_len = self.indices.len();
        let data_ptr = self.data.as_ptr();
        let data_len = self.data.len();

        mem::forget(self);

        (rows, cols, indptr_ptr, indptr_len, indices_ptr, indices_len, data_ptr, data_len)
    }

    pub fn random_sparse(rows: usize, cols: usize, density: f64) -> Self {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        let mut indptr = vec![0u32; rows + 1];
        let mut indices = Vec::new();
        let mut data = Vec::new();

        for i in 0..rows {
            for j in 0..cols {
                if rng.gen::<f64>() < density {
                    let value = rng.gen_range(0.1..10.0);
                    indices.push(j as u32);
                    data.push(value);
                    indptr[i + 1] += 1;
                }
            }
            indptr[i + 1] += indptr[i];
        }

        CSRMatrix {
            rows,
            cols,
            indptr,
            indices,
            data,
        }
    }
}

impl CSRMatrix {
    pub fn indptr(&self) -> &[u32] {
        &self.indptr
    }

    pub fn indices(&self) -> &[u32] {
        &self.indices
    }

    pub fn data(&self) -> &[f64] {
        &self.data
    }
}
