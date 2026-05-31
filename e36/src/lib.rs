#![allow(non_snake_case)]

use wasm_bindgen::prelude::*;
use web_sys::ImageData;

mod filters;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn applyGrayscale(data: &mut [u8], width: u32, height: u32, intensity: f32) {
    filters::grayscale(data, width, height, intensity);
}

#[wasm_bindgen]
pub fn applyVintage(data: &mut [u8], width: u32, height: u32, intensity: f32) {
    filters::vintage(data, width, height, intensity);
}

#[wasm_bindgen]
pub fn applySobelEdge(data: &mut [u8], width: u32, height: u32, intensity: f32) {
    filters::sobel_edge(data, width, height, intensity);
}
