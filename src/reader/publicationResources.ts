const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const CSS_HEX = /^[\da-f]$/i;

export type PublicationUrlBuilder = (path: string) => string | null;

interface ReferenceParts {
  path: string;
  query: string;
  fragment: string;
}

interface CssString {
  end: number;
  value: string;
  valueEnd: number;
  valueStart: number;
}

interface CssUrl {
  end: number;
  quote: "'" | '"' | null;
  reference: string;
  valueEnd: number;
  valueStart: number;
}

interface Replacement {
  end: number;
  start: number;
  value: string;
}

function splitReference(reference: string): ReferenceParts {
  const hashAt = reference.indexOf("#");
  const beforeFragment = hashAt < 0 ? reference : reference.slice(0, hashAt);
  const questionAt = beforeFragment.indexOf("?");

  return {
    path: questionAt < 0 ? beforeFragment : beforeFragment.slice(0, questionAt),
    query: questionAt < 0 ? "" : beforeFragment.slice(questionAt),
    fragment: hashAt < 0 ? "" : reference.slice(hashAt),
  };
}

function decodePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (/[/\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function canonicalSectionSegments(sectionPath: string): string[] | null {
  const { path } = splitReference(sectionPath);
  const segments: string[] = [];

  for (const rawSegment of path.replace(/^\/+/, "").split("/")) {
    if (!rawSegment) continue;
    const segment = decodePathSegment(rawSegment);
    if (!segment || segment === "." || segment === "..") return null;
    segments.push(encodeURIComponent(segment));
  }

  return segments.length > 0 ? segments : null;
}

function encodeReferenceSuffix(path: string, query: string, fragment: string): string {
  const url = new URL(`${path}${query}${fragment}`, "https://publication.invalid/");
  return `${url.pathname.slice(1)}${url.search}${url.hash}`;
}

function isExternalReference(reference: string): boolean {
  return URI_SCHEME.test(reference) || reference.startsWith("//");
}

export function resolvePublicationPath(
  sectionPath: string,
  reference: string,
): string | null {
  if (!reference || isExternalReference(reference)) return null;

  const sectionSegments = canonicalSectionSegments(sectionPath);
  if (!sectionSegments) return null;

  const { path, query, fragment } = splitReference(reference);
  const resolved = path.startsWith("/") ? [] : sectionSegments.slice(0, -1);

  if (!path) {
    return encodeReferenceSuffix(sectionSegments.join("/"), query, fragment);
  }

  for (const rawSegment of path.replace(/^\/+/, "").split("/")) {
    if (!rawSegment) continue;
    const segment = decodePathSegment(rawSegment);
    if (segment === null) return null;
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    if (!segment) continue;
    resolved.push(encodeURIComponent(segment));
  }

  if (resolved.length === 0) return null;
  return encodeReferenceSuffix(resolved.join("/"), query, fragment);
}

export function buildPublicationResourceUrl(
  root: string,
  sessionId: string,
  path: string,
): string {
  const rootUrl = new URL(root);
  if (rootUrl.search || rootUrl.hash) {
    throw new TypeError("The resource root cannot include a query or fragment");
  }

  const canonicalPath = canonicalSectionSegments(path);
  if (!canonicalPath) throw new TypeError("The resource path is not canonical");

  const { query, fragment } = splitReference(path);
  rootUrl.pathname = `${rootUrl.pathname.replace(/\/+$/, "")}/`;
  const resource = new URL(
    `${encodeURIComponent(sessionId)}/${canonicalPath.join("/")}${query}${fragment}`,
    rootUrl,
  );
  return resource.href;
}

function isCssWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r" || value === "\f";
}

function isCssIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[-_\da-z\u0080-\uffff]/i.test(value);
}

function skipCssComment(css: string, start: number): number {
  const close = css.indexOf("*/", start + 2);
  return close < 0 ? css.length : close + 2;
}

function consumeCssTrivia(css: string, start: number): number {
  let cursor = start;
  while (cursor < css.length) {
    if (isCssWhitespace(css[cursor]!)) {
      cursor += 1;
    } else if (css.startsWith("/*", cursor)) {
      cursor = skipCssComment(css, cursor);
    } else {
      break;
    }
  }
  return cursor;
}

function readCssEscape(
  css: string,
  start: number,
): { end: number; value: string } | null {
  let cursor = start + 1;
  if (cursor >= css.length) return null;

  const first = css[cursor]!;
  if (first === "\n" || first === "\f") return { end: cursor + 1, value: "" };
  if (first === "\r") {
    return {
      end: css[cursor + 1] === "\n" ? cursor + 2 : cursor + 1,
      value: "",
    };
  }

  if (!CSS_HEX.test(first)) return { end: cursor + 1, value: first };

  const hexStart = cursor;
  while (cursor < css.length && cursor - hexStart < 6 && CSS_HEX.test(css[cursor]!)) {
    cursor += 1;
  }
  const codePoint = Number.parseInt(css.slice(hexStart, cursor), 16);
  if (isCssWhitespace(css[cursor] ?? "")) {
    if (css[cursor] === "\r" && css[cursor + 1] === "\n") cursor += 2;
    else cursor += 1;
  }

  const value =
    codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? "\uFFFD"
      : String.fromCodePoint(codePoint);
  return { end: cursor, value };
}

function readCssString(css: string, start: number): CssString | null {
  const quote = css[start];
  if (quote !== "'" && quote !== '"') return null;

  let cursor = start + 1;
  let value = "";
  while (cursor < css.length) {
    const character = css[cursor]!;
    if (character === quote) {
      return {
        end: cursor + 1,
        value,
        valueEnd: cursor,
        valueStart: start + 1,
      };
    }
    if (character === "\n" || character === "\r" || character === "\f") return null;
    if (character === "\\") {
      const escape = readCssEscape(css, cursor);
      if (!escape) return null;
      value += escape.value;
      cursor = escape.end;
      continue;
    }
    value += character;
    cursor += 1;
  }
  return null;
}

function readCssUrl(css: string, start: number): CssUrl | null {
  let cursor = consumeCssTrivia(css, start + 4);
  const quote = css[cursor];

  if (quote === "'" || quote === '"') {
    const string = readCssString(css, cursor);
    if (!string) return null;
    cursor = consumeCssTrivia(css, string.end);
    if (css[cursor] !== ")") return null;
    return {
      end: cursor + 1,
      quote,
      reference: string.value,
      valueEnd: string.valueEnd,
      valueStart: string.valueStart,
    };
  }

  const valueStart = cursor;
  let valueEnd = cursor;
  let reference = "";
  let trailingTrivia = false;

  while (cursor < css.length) {
    const character = css[cursor]!;
    if (character === ")") {
      return {
        end: cursor + 1,
        quote: null,
        reference,
        valueEnd,
        valueStart,
      };
    }
    if (isCssWhitespace(character) || css.startsWith("/*", cursor)) {
      trailingTrivia = true;
      cursor = css.startsWith("/*", cursor)
        ? skipCssComment(css, cursor)
        : cursor + 1;
      continue;
    }
    if (trailingTrivia || character === "'" || character === '"' || character === "(") {
      return null;
    }
    if (character === "\\") {
      const escape = readCssEscape(css, cursor);
      if (!escape) return null;
      reference += escape.value;
      cursor = escape.end;
      valueEnd = cursor;
      continue;
    }
    reference += character;
    cursor += 1;
    valueEnd = cursor;
  }

  return null;
}

function escapeCssString(value: string, quote: "'" | '"'): string {
  let escaped = "";
  for (const character of value) {
    if (character === "\\" || character === quote) escaped += `\\${character}`;
    else if (character === "\n") escaped += "\\a ";
    else if (character === "\r") escaped += "\\d ";
    else if (character === "\f") escaped += "\\c ";
    else escaped += character;
  }
  return escaped;
}

function rewriteReference(
  sectionPath: string,
  reference: string,
  toUrl: PublicationUrlBuilder,
): string | null {
  if (!reference || reference.startsWith("#") || isExternalReference(reference)) return null;
  const resolved = resolvePublicationPath(sectionPath, reference);
  return resolved ? toUrl(resolved) : null;
}

function applyReplacements(value: string, replacements: Replacement[]): string {
  if (replacements.length === 0) return value;
  let output = "";
  let copiedThrough = 0;
  for (const replacement of replacements) {
    output += value.slice(copiedThrough, replacement.start);
    output += replacement.value;
    copiedThrough = replacement.end;
  }
  return output + value.slice(copiedThrough);
}

export function rewritePublicationCss(
  css: string,
  sectionPath: string,
  toUrl: PublicationUrlBuilder,
): string {
  const replacements: Replacement[] = [];
  let cursor = 0;

  while (cursor < css.length) {
    if (css.startsWith("/*", cursor)) {
      cursor = skipCssComment(css, cursor);
      continue;
    }

    const character = css[cursor]!;
    if (character === "'" || character === '"') {
      cursor = readCssString(css, cursor)?.end ?? css.length;
      continue;
    }

    if (
      css.slice(cursor, cursor + 4).toLowerCase() === "url(" &&
      !isCssIdentifierCharacter(css[cursor - 1])
    ) {
      const token = readCssUrl(css, cursor);
      if (token) {
        const resourceUrl = rewriteReference(sectionPath, token.reference, toUrl);
        if (resourceUrl) {
          const quote = token.quote ?? '"';
          replacements.push({
            start: token.valueStart,
            end: token.valueEnd,
            value: token.quote
              ? escapeCssString(resourceUrl, quote)
              : `"${escapeCssString(resourceUrl, '"')}"`,
          });
        }
        cursor = token.end;
        continue;
      }
    }

    if (
      character === "@" &&
      css.slice(cursor + 1, cursor + 7).toLowerCase() === "import" &&
      !isCssIdentifierCharacter(css[cursor + 7])
    ) {
      const valueStart = consumeCssTrivia(css, cursor + 7);
      const token = readCssString(css, valueStart);
      if (token) {
        const resourceUrl = rewriteReference(sectionPath, token.value, toUrl);
        if (resourceUrl) {
          const quote = css[valueStart] as "'" | '"';
          replacements.push({
            start: token.valueStart,
            end: token.valueEnd,
            value: escapeCssString(resourceUrl, quote),
          });
        }
        cursor = token.end;
        continue;
      }
    }

    cursor += 1;
  }

  return applyReplacements(css, replacements);
}

export function rewritePublicationSrcset(
  srcset: string,
  sectionPath: string,
  toUrl: PublicationUrlBuilder,
): string {
  const replacements: Replacement[] = [];
  let cursor = 0;

  while (cursor < srcset.length) {
    while (
      cursor < srcset.length &&
      (isCssWhitespace(srcset[cursor]!) || srcset[cursor] === ",")
    ) {
      cursor += 1;
    }
    if (cursor >= srcset.length) break;

    const urlStart = cursor;
    while (cursor < srcset.length && !isCssWhitespace(srcset[cursor]!)) cursor += 1;

    let urlEnd = cursor;
    while (urlEnd > urlStart && srcset[urlEnd - 1] === ",") urlEnd -= 1;
    const reference = srcset.slice(urlStart, urlEnd);
    const resourceUrl = rewriteReference(sectionPath, reference, toUrl);
    if (resourceUrl) {
      replacements.push({ start: urlStart, end: urlEnd, value: resourceUrl });
    }

    if (urlEnd < cursor) continue;

    let parentheses = 0;
    while (cursor < srcset.length) {
      const character = srcset[cursor]!;
      if (character === "(") parentheses += 1;
      else if (character === ")" && parentheses > 0) parentheses -= 1;
      else if (character === "," && parentheses === 0) {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
  }

  return applyReplacements(srcset, replacements);
}
