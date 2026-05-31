#[cfg(test)]
mod tests {
    use crate::compression::Simple8B;

    #[test]
    fn test_simple8b_compress_decompress() {
        let timestamps = vec![100, 200, 300, 400, 500];
        let deltas: Vec<u64> = timestamps.windows(2)
            .map(|w| (w[1] - w[0]) as u64)
            .collect();
        
        let compressed = Simple8B::compress(&deltas).unwrap();
        assert!(!compressed.is_empty());
        
        let decompressed = Simple8B::decompress(&compressed).unwrap();
        assert_eq!(decompressed, deltas);
    }
}
