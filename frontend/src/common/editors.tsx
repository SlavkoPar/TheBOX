// In-app editors for Drive documents: plain text, rich text (HTML) and spreadsheets (CSV).

import { useLayoutEffect, useRef, useState } from 'react'
import type { FileItem } from '../api'
import { FormModal } from './Modal'
import { columnName, parseCsv, toCsv, toGrid } from './csv'
import { Icon } from './icons'
import { cleanHtml } from './richText'

type EditorProps = {
  file: FileItem
  initial: string
  onClose: () => void
  onSave: (content: string) => Promise<unknown>
}

// --- Plain text -------------------------------------------------------------------

export function TextEditor({ file, initial, onClose, onSave }: EditorProps) {
  const [content, setContent] = useState(initial)
  return (
    <FormModal title={file.name} submitLabel="Save" onClose={onClose} onSubmit={() => onSave(content)} wide>
      <label>
        <span className="visually-hidden">Content</span>
        <textarea
          className="editor"
          rows={18}
          value={content}
          autoFocus
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
    </FormModal>
  )
}

// --- Rich text --------------------------------------------------------------------

const FORMATS: { label: string; command: string; value?: string; text: string }[] = [
  { label: 'Bold', command: 'bold', text: 'B' },
  { label: 'Italic', command: 'italic', text: 'I' },
  { label: 'Underline', command: 'underline', text: 'U' },
  { label: 'Heading', command: 'formatBlock', value: 'h2', text: 'H' },
  { label: 'Subheading', command: 'formatBlock', value: 'h3', text: 'h' },
  { label: 'Normal text', command: 'formatBlock', value: 'p', text: '¶' },
  { label: 'Bulleted list', command: 'insertUnorderedList', text: '•' },
  { label: 'Numbered list', command: 'insertOrderedList', text: '1.' },
]

export function RichTextEditor({ file, initial, onClose, onSave }: EditorProps) {
  const body = useRef<HTMLDivElement>(null)

  // Set once, before the first paint: React must not re-render the edited content.
  useLayoutEffect(() => {
    if (body.current) body.current.innerHTML = cleanHtml(initial)
  }, [initial])

  function format(command: string, value?: string) {
    body.current?.focus()
    document.execCommand?.(command, false, value)
  }

  return (
    <FormModal
      title={file.name}
      submitLabel="Save"
      onClose={onClose}
      onSubmit={() => onSave(cleanHtml(body.current?.innerHTML ?? ''))}
      wide
    >
      <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
        {FORMATS.map(({ label, command, value, text }) => (
          <button
            key={label}
            type="button"
            className="secondary"
            aria-label={label}
            title={label}
            // Keep the text selection: a normal click would move focus to the button.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(command, value)}
          >
            <span className={`format-${command}`}>{text}</span>
          </button>
        ))}
      </div>
      <div
        ref={body}
        className="rich-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Document"
        suppressContentEditableWarning
      />
    </FormModal>
  )
}

// --- Spreadsheet -------------------------------------------------------------------

export function SheetEditor({ file, initial, onClose, onSave }: EditorProps) {
  const [rows, setRows] = useState(() => toGrid(parseCsv(initial), 5, 4))
  const width = rows[0].length

  function setCell(r: number, c: number, value: string) {
    setRows(rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)))
  }

  function save() {
    // Drop empty rows at the bottom and empty columns on the right.
    const used = rows.slice()
    while (used.length > 0 && used[used.length - 1].every((cell) => cell === '')) used.pop()
    const cols = Math.max(0, ...used.map((row) => row.findLastIndex((cell) => cell !== '') + 1))
    return onSave(toCsv(used.map((row) => row.slice(0, cols))))
  }

  return (
    <FormModal title={file.name} submitLabel="Save" onClose={onClose} onSubmit={save} wide>
      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th />
              {rows[0].map((_, c) => (
                <th key={c} scope="col">
                  {columnName(c)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <th scope="row">{r + 1}</th>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input
                      value={cell}
                      aria-label={`${columnName(c)}${r + 1}`}
                      onChange={(event) => setCell(r, c, event.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete row ${r + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((_, i) => i !== r))}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button type="button" className="secondary" onClick={() => setRows([...rows, Array(width).fill('')])}>
          <Icon name="plus" size={18} /> Add row
        </button>
        <button type="button" className="secondary" onClick={() => setRows(rows.map((row) => [...row, '']))}>
          <Icon name="plus" size={18} /> Add column
        </button>
        <button
          type="button"
          className="secondary"
          disabled={width === 1}
          onClick={() => setRows(rows.map((row) => row.slice(0, -1)))}
        >
          Remove last column
        </button>
      </div>
    </FormModal>
  )
}
