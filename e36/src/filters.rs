use std::cell::RefCell;

thread_local! {
    static GRAY_BUFFER: RefCell<Vec<u8>> = RefCell::new(Vec::new());
}

#[inline]
fn clamp_u8(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

#[inline]
fn fast_sqrt(x: f32) -> f32 {
    x.sqrt()
}

pub fn grayscale(data: &mut [u8], _width: u32, _height: u32, intensity: f32) {
    let intensity = intensity.clamp(0.0, 1.0);
    let intensity_i = (intensity * 256.0) as i32;
    let inv_intensity_i = 256 - intensity_i;
    
    for pixel in data.chunks_exact_mut(4) {
        let r = pixel[0] as i32;
        let g = pixel[1] as i32;
        let b = pixel[2] as i32;
        
        let gray = (r * 299 + g * 587 + b * 114) / 1000;
        
        pixel[0] = clamp_u8((r * inv_intensity_i + gray * intensity_i) / 256);
        pixel[1] = clamp_u8((g * inv_intensity_i + gray * intensity_i) / 256);
        pixel[2] = clamp_u8((b * inv_intensity_i + gray * intensity_i) / 256);
    }
}

pub fn vintage(data: &mut [u8], _width: u32, _height: u32, intensity: f32) {
    let intensity = intensity.clamp(0.0, 1.0);
    let intensity_i = (intensity * 256.0) as i32;
    let inv_intensity_i = 256 - intensity_i;
    
    for pixel in data.chunks_exact_mut(4) {
        let r = pixel[0] as i32;
        let g = pixel[1] as i32;
        let b = pixel[2] as i32;
        
        let new_r = (r * 307 + g * 26 + b * 13) / 256;
        let new_g = (r * 26 + g * 230 + b * 26) / 256;
        let new_b = (r * 13 + g * 26 + b * 179) / 256;
        
        pixel[0] = clamp_u8((r * inv_intensity_i + new_r * intensity_i) / 256);
        pixel[1] = clamp_u8((g * inv_intensity_i + new_g * intensity_i) / 256);
        pixel[2] = clamp_u8((b * inv_intensity_i + new_b * intensity_i) / 256);
    }
}

pub fn sobel_edge(data: &mut [u8], width: u32, height: u32, intensity: f32) {
    let intensity = intensity.clamp(0.0, 1.0);
    let width = width as usize;
    let height = height as usize;
    let size = width * height;
    
    GRAY_BUFFER.with(|buffer| {
        let mut gray_buf = buffer.borrow_mut();
        gray_buf.resize(size, 0);
        
        for i in 0..size {
            let idx = i * 4;
            let r = data[idx] as i32;
            let g = data[idx + 1] as i32;
            let b = data[idx + 2] as i32;
            gray_buf[i] = ((r * 299 + g * 587 + b * 114) / 1000) as u8;
        }
        
        let intensity_scaled = (intensity * 256.0) as i32;
        
        for y in 1..height - 1 {
            let y_base = y * width;
            for x in 1..width - 1 {
                let idx = y_base + x;
                
                let p0 = gray_buf[idx - width - 1] as i32;
                let p1 = gray_buf[idx - width] as i32;
                let p2 = gray_buf[idx - width + 1] as i32;
                let p3 = gray_buf[idx - 1] as i32;
                let p5 = gray_buf[idx + 1] as i32;
                let p6 = gray_buf[idx + width - 1] as i32;
                let p7 = gray_buf[idx + width] as i32;
                let p8 = gray_buf[idx + width + 1] as i32;
                
                let gx = -p0 + p2 - 2 * p3 + 2 * p5 - p6 + p8;
                let gy = -p0 - 2 * p1 - p2 + p6 + 2 * p7 + p8;
                
                let magnitude = fast_sqrt((gx * gx + gy * gy) as f32);
                let edge = ((magnitude * intensity_scaled as f32) / 256.0) as i32;
                let edge_u8 = clamp_u8(edge);
                
                let pixel_idx = idx * 4;
                data[pixel_idx] = edge_u8;
                data[pixel_idx + 1] = edge_u8;
                data[pixel_idx + 2] = edge_u8;
            }
        }
    });
}

