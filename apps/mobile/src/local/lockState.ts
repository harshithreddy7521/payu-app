let externalUntil = 0;
export function allowSystemPicker() {
  externalUntil = Date.now() + 120000;
}
export function endSystemPicker() {
  externalUntil = 0;
}
export function systemPickerActive() {
  return Date.now() < externalUntil;
}
