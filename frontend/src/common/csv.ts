// CSV reading and writing for the spreadsheet editor (RFC 4180 quoting).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','),
    )
    .join('\n')
    .concat(rows.length > 0 ? '\n' : '')
}

/** Same number of cells in every row, and at least `minRows` x `minCols`. */
export function toGrid(rows: string[][], minRows = 1, minCols = 1): string[][] {
  const width = Math.max(minCols, ...rows.map((row) => row.length))
  const grid = rows.map((row) => [...row, ...Array(width - row.length).fill('')])
  while (grid.length < minRows) grid.push(Array(width).fill(''))
  return grid
}

/** Spreadsheet-style column name: A, B, … Z, AA, AB, … */
export function columnName(index: number): string {
  let name = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name
  }
  return name
}
