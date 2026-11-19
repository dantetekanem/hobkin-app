/**
 * How many bytes `text` takes in UTF-8, as the host counts it against hobkin's cap. Counted in place on every
 * keystroke, so a 35 KB file is never encoded just to be measured. A lone surrogate counts as the three bytes of
 * the replacement character it is saved as.
 */
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 4
      index++
    } else bytes += 3
  }
  return bytes
}
