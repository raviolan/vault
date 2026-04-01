export function stripMarkdownStyling(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/(^|\s)([*_~]{1,3})(\S.*?\S)\2(?=\s|$)/g, '$1$3')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/(^|\n)\s{0,3}>\s?/g, '$1')
    .replace(/(^|\n)\s*([-*+]|\d+\.)\s+/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
