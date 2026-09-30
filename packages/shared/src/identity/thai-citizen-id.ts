// Thai citizen ID (เลขประจำตัวประชาชน) validation.
//
// 13 digits; the 13th is a check digit: the first 12 digits are weighted
// 13, 12, …, 2, summed, and the check digit is (11 - sum mod 11) mod 10.
// Validating it at an API boundary turns a typo into a 400 instead of a
// 404 that looks like "this person is not on staff".

/** Strip the dashes and whitespace people type; nothing else. */
export function normaliseThaiCitizenId(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function isValidThaiCitizenId(raw: string): boolean {
  const id = normaliseThaiCitizenId(raw);
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}
