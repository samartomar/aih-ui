// Keep imported file bytes independently of the textarea's newline projection.
export function policyFile(textarea) {
  let original;
  textarea.addEventListener('input', () => { original = undefined; });
  return {
    bytes: () => original?.slice() ?? new TextEncoder().encode(textarea.value),
    text: () => original ? new TextDecoder().decode(original) : textarea.value,
    setBytes(bytes) { original = bytes.slice(); textarea.value = new TextDecoder().decode(bytes); },
    setText(text) { original = new TextEncoder().encode(text); textarea.value = text; }
  };
}
