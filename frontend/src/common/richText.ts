import DOMPurify from 'dompurify'

/**
 * Formatting the rich text editor keeps. Everything else — scripts, event
 * handlers, styles, images, frames — is dropped, both when a document is
 * opened and when it is saved.
 */
const RICH_TEXT = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a',
  ],
  ALLOWED_ATTR: ['href'],
}

export function cleanHtml(html: string): string {
  return DOMPurify.sanitize(html, RICH_TEXT)
}
