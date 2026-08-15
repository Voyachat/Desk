use getrandom::fill;
use zeroize::Zeroizing;

pub(crate) fn random_hex(byte_count: usize) -> Result<String, ()> {
    let mut bytes = Zeroizing::new(vec![0u8; byte_count]);
    fill(&mut bytes).map_err(|_| ())?;
    let mut output = String::with_capacity(byte_count * 2);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes.iter().copied() {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(output)
}
