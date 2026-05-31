use super::csr::CSRMatrix;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;
use std::collections::HashMap;

#[wasm_bindgen]
pub fn multiply_parallel_raw(
    a_rows: usize,
    a_cols: usize,
    a_indptr_ptr: *const u32,
    a_indptr_len: usize,
    a_indices_ptr: *const u32,
    a_indices_len: usize,
    a_data_ptr: *const f64,
    a_data_len: usize,
    b_rows: usize,
    b_cols: usize,
    b_indptr_ptr: *const u32,
    b_indptr_len: usize,
    b_indices_ptr: *const u32,
    b_indices_len: usize,
    b_data_ptr: *const f64,
    b_data_len: usize,
    callback: &js_sys::Function,
) -> *mut u8 {
    assert_eq!(a_cols, b_rows);

    let a_indptr = unsafe { std::slice::from_raw_parts(a_indptr_ptr, a_indptr_len) };
    let a_indices = unsafe { std::slice::from_raw_parts(a_indices_ptr, a_indices_len) };
    let a_data = unsafe { std::slice::from_raw_parts(a_data_ptr, a_data_len) };
    let b_indptr = unsafe { std::slice::from_raw_parts(b_indptr_ptr, b_indptr_len) };
    let b_indices = unsafe { std::slice::from_raw_parts(b_indices_ptr, b_indices_len) };
    let b_data = unsafe { std::slice::from_raw_parts(b_data_ptr, b_data_len) };

    let m = a_rows;
    let n = b_cols;

    let total_work = m;
    let completed = std::sync::atomic::AtomicUsize::new(0);

    let rows_result: Vec<HashMap<u32, f64>> = (0..m)
        .into_par_iter()
        .map(|i| {
            let mut row = HashMap::new();

            for a_idx in a_indptr[i] as usize..a_indptr[i + 1] as usize {
                let a_col = a_indices[a_idx] as usize;
                let a_val = a_data[a_idx];

                for b_idx in b_indptr[a_col] as usize..b_indptr[a_col + 1] as usize {
                    let b_col = b_indices[b_idx];
                    let b_val = b_data[b_idx];
                    *row.entry(b_col).or_insert(0.0) += a_val * b_val;
                }
            }

            let prev = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if prev % (m / 20 + 1) == 0 {
                let progress = ((prev as f64 / total_work as f64) * 80.0) as u32;
                let _ = callback.call1(&JsValue::NULL, &JsValue::from(progress));
            }

            row
        })
        .collect();

    let _ = callback.call1(&JsValue::NULL, &JsValue::from(85));

    let mut indptr = vec![0u32; m + 1];
    let mut indices = Vec::new();
    let mut data = Vec::new();

    for (i, row) in rows_result.iter().enumerate() {
        let mut sorted_entries: Vec<_> = row.iter().collect();
        sorted_entries.sort_by_key(|(&col, _)| col);

        for (&col, &val) in sorted_entries {
            indices.push(col);
            data.push(val);
        }
        indptr[i + 1] = indptr[i] + row.len() as u32;

        if i % (m / 10 + 1) == 0 {
            let progress = 85 + ((i as f64 / m as f64) * 15.0) as u32;
            let _ = callback.call1(&JsValue::NULL, &JsValue::from(progress));
        }
    }

    let _ = callback.call1(&JsValue::NULL, &JsValue::from(100));

    let result = CSRMatrix {
        rows: m,
        cols: n,
        indptr,
        indices,
        data,
    };

    Box::into_raw(Box::new(result)) as *mut u8
}

#[wasm_bindgen]
pub unsafe fn get_result_matrix(ptr: *mut u8) -> *mut CSRMatrix {
    ptr as *mut CSRMatrix
}

#[wasm_bindgen]
pub unsafe fn free_result_matrix(ptr: *mut CSRMatrix) {
    let _ = Box::from_raw(ptr);
}
