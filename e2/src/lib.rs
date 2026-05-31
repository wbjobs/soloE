use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};

#[wasm_bindgen]
pub fn compute_fft(pcm_data: &[f32]) -> Vec<f32> {
    let len = pcm_data.len();
    
    if len == 0 {
        return Vec::new();
    }
    
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(len);
    
    let mut buffer: Vec<Complex<f32>> = pcm_data
        .iter()
        .map(|&x| Complex::new(x, 0.0))
        .collect();
    
    fft.process(&mut buffer);
    
    let spectrum_len = len / 2;
    let spectrum: Vec<f32> = buffer
        .iter()
        .take(spectrum_len)
        .map(|c| c.norm())
        .collect();
    
    spectrum
}

#[wasm_bindgen]
pub fn next_power_of_two(n: usize) -> usize {
    if n == 0 {
        return 1;
    }
    let mut result = 1;
    while result < n {
        result *= 2;
    }
    result
}
