export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function memberCsv(text: string) {
  const [headers, ...rows] = parseCsv(text);
  if (
    !headers ||
    !["name", "externalRef", "guardianName", "phone"].every((h) =>
      headers.includes(h),
    )
  )
    throw new Error("CSV needs headers: name,externalRef,guardianName,phone");
  if (rows.length > 500 || !rows.length)
    throw new Error("Import between 1 and 500 rows");
  const refs = new Set<string>();
  return rows.map((row, index) => {
    const value = (key: string) => row[headers.indexOf(key)] ?? "";
    const name = value("name"),
      externalRef = value("externalRef"),
      guardianName = value("guardianName"),
      phone = value("phone");
    const errors: string[] = [];
    if (!name || name.length > 120)
      errors.push("Name is required (up to 120 characters)");
    if (!externalRef)
      errors.push("Reference is required for safe duplicate detection");
    if (refs.has(externalRef)) errors.push("Duplicate reference in file");
    refs.add(externalRef);
    if (phone && !/^(?:\+91)?[6-9]\d{9}$/.test(phone))
      errors.push("Use a valid Indian mobile number");
    if (phone && !guardianName)
      errors.push("Guardian name is required with a phone");
    return { row: index + 2, name, externalRef, guardianName, phone, errors };
  });
}
