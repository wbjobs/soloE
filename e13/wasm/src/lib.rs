use wasm_bindgen::prelude::*;
use js_sys::Uint8ClampedArray;

#[wasm_bindgen]
pub struct ImageProcessor {
    width: u32,
    height: u32,
    buffer: Vec<u8>,
}

#[wasm_bindgen]
impl ImageProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> ImageProcessor {
        let size = (width * height * 4) as usize;
        ImageProcessor {
            width,
            height,
            buffer: vec![0; size],
        }
    }

    pub fn load_from_js(&mut self, data: &Uint8ClampedArray) {
        data.copy_to(&mut self.buffer);
    }

    pub fn copy_to_js(&self, data: &Uint8ClampedArray) {
        data.copy_from(&self.buffer);
    }

    #[inline(always)]
    fn as_chunks_exact_mut<const N: usize>(slice: &mut [u8]) -> (&mut [[u8; N]], &mut [u8]) {
        let len = slice.len() / N;
        let (head, tail) = slice.split_at_mut(len * N);
        unsafe {
            (std::slice::from_raw_parts_mut(head.as_mut_ptr() as *mut [u8; N], len), tail)
        }
    }

    pub fn grayscale(&mut self) {
        let buffer = &mut self.buffer;
        let len = buffer.len() / 4;
        
        let (chunks, _) = Self::as_chunks_exact_mut::<4>(buffer);
        
        for chunk in chunks.iter_mut().take(len) {
            let r = chunk[0] as u32;
            let g = chunk[1] as u32;
            let b = chunk[2] as u32;
            
            let gray = ((r * 19595 + g * 38470 + b * 7471 + 32768) >> 16) as u8;
            
            chunk[0] = gray;
            chunk[1] = gray;
            chunk[2] = gray;
        }
    }

    pub fn invert(&mut self) {
        let buffer = &mut self.buffer;
        let len = buffer.len() / 4;
        
        let (chunks, _) = Self::as_chunks_exact_mut::<4>(buffer);
        
        for chunk in chunks.iter_mut().take(len) {
            chunk[0] = 255 - chunk[0];
            chunk[1] = 255 - chunk[1];
            chunk[2] = 255 - chunk[2];
        }
    }

    pub fn buffer_ptr(&self) -> *const u8 {
        self.buffer.as_ptr()
    }
}
