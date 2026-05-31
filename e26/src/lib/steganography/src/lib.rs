use wasm_bindgen::prelude::*;

const MAGIC_NUMBER: [u8; 4] = [0x53, 0x54, 0x45, 0x47];
const MAGIC_LENGTH: usize = MAGIC_NUMBER.len();
const LENGTH_FIELD_SIZE: usize = 4;
const CHECKSUM_SIZE: usize = 4;
const HEADER_SIZE: usize = MAGIC_LENGTH + LENGTH_FIELD_SIZE + CHECKSUM_SIZE;

fn calculate_checksum(data: &[u8]) -> u32 {
    let mut checksum: i32 = 0;
    for &byte in data {
        checksum = ((checksum << 5) - checksum + byte as i32) | 0;
    }
    checksum as u32
}

fn write_bit_to_pixel(pixels: &mut [u8], bit_index: usize, bit_value: u8) -> Result<(), JsValue> {
    let pixel_index = bit_index * 4;
    if pixel_index + 2 >= pixels.len() {
        return Err(JsValue::from_str("Pixel buffer too small"));
    }
    pixels[pixel_index + 2] = (pixels[pixel_index + 2] & 0xFE) | bit_value;
    Ok(())
}

fn read_bit_from_pixel(pixels: &[u8], bit_index: usize) -> Result<u8, JsValue> {
    let pixel_index = bit_index * 4;
    if pixel_index + 2 >= pixels.len() {
        return Err(JsValue::from_str("Pixel buffer too small"));
    }
    Ok(pixels[pixel_index + 2] & 1)
}

fn write_bytes(pixels: &mut [u8], start_bit_index: usize, bytes: &[u8]) -> Result<usize, JsValue> {
    let mut bit_index = start_bit_index;
    for &byte in bytes {
        for bit in 0..8 {
            let bit_value = (byte >> (7 - bit)) & 1;
            write_bit_to_pixel(pixels, bit_index, bit_value)?;
            bit_index += 1;
        }
    }
    Ok(bit_index)
}

fn read_bytes(pixels: &[u8], start_bit_index: usize, length: usize) -> Result<(Vec<u8>, usize), JsValue> {
    let mut bytes = Vec::with_capacity(length);
    let mut bit_index = start_bit_index;
    for _ in 0..length {
        let mut byte = 0u8;
        for bit in 0..8 {
            let bit_value = read_bit_from_pixel(pixels, bit_index)?;
            byte = (byte << 1) | bit_value;
            bit_index += 1;
        }
        bytes.push(byte);
    }
    Ok((bytes, bit_index))
}

#[wasm_bindgen]
pub fn encode_message(pixels: &mut [u8], width: u32, height: u32, message: &str) -> Result<(), JsValue> {
    let message_bytes = message.as_bytes();
    let message_len = message_bytes.len();

    let max_bytes = (width * height) as usize / 8;
    if message_len + HEADER_SIZE > max_bytes {
        return Err(JsValue::from_str(&format!(
            "Message too long. Max: {} bytes, got: {} bytes",
            max_bytes - HEADER_SIZE,
            message_len
        )));
    }

    let checksum = calculate_checksum(message_bytes);
    let len_bytes = (message_len as u32).to_be_bytes();
    let checksum_bytes = checksum.to_be_bytes();

    let mut bit_index = 0;

    bit_index = write_bytes(pixels, bit_index, &MAGIC_NUMBER)?;
    bit_index = write_bytes(pixels, bit_index, &len_bytes)?;
    bit_index = write_bytes(pixels, bit_index, &checksum_bytes)?;
    write_bytes(pixels, bit_index, message_bytes)?;

    Ok(())
}

#[wasm_bindgen]
pub fn decode_message(pixels: &[u8], width: u32, height: u32) -> Result<String, JsValue> {
    let mut bit_index = 0;

    let (magic_bytes, after_magic) = read_bytes(pixels, bit_index, MAGIC_LENGTH)?;
    bit_index = after_magic;

    for i in 0..MAGIC_LENGTH {
        if magic_bytes[i] != MAGIC_NUMBER[i] {
            return Err(JsValue::from_str(
                "No hidden message found: invalid magic number",
            ));
        }
    }

    let (len_bytes, after_len) = read_bytes(pixels, bit_index, LENGTH_FIELD_SIZE)?;
    bit_index = after_len;

    let message_len = u32::from_be_bytes(len_bytes.try_into().unwrap()) as usize;

    let max_bytes = (width * height) as usize / 8 - HEADER_SIZE;
    if message_len > max_bytes || message_len == 0 {
        return Err(JsValue::from_str(
            "No hidden message found or message corrupted",
        ));
    }

    let (checksum_bytes, after_checksum) = read_bytes(pixels, bit_index, CHECKSUM_SIZE)?;
    bit_index = after_checksum;

    let expected_checksum = u32::from_be_bytes(checksum_bytes.try_into().unwrap());

    let (message_bytes, _) = read_bytes(pixels, bit_index, message_len)?;

    let actual_checksum = calculate_checksum(&message_bytes);
    if actual_checksum != expected_checksum {
        return Err(JsValue::from_str(
            "Message corrupted: checksum mismatch",
        ));
    }

    String::from_utf8(message_bytes)
        .map_err(|_| JsValue::from_str("Failed to decode message as UTF-8"))
}

#[wasm_bindgen]
pub fn get_max_message_size(width: u32, height: u32) -> u32 {
    (width * height) / 8 - HEADER_SIZE as u32
}
