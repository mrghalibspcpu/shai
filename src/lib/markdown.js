/**
 * SHAI · Markdown renderer (RTL / Urdu first)
 * ─────────────────────────────────────────────────────────────
 * A small, dependency-free, XSS-safe markdown renderer tuned for
 * Urdu + Arabic output.
 *
 * Extra block types on top of CommonMark:
 *   ```ar   … Arabic matan (Amiri, fully vowelled)
 *   ```q    … Qurʾānic verse (optional trailing "2:255" line = surah:verse)
 *   ```tr   … Urdu translation strip that attaches under the block above
 *   ```refs … structured citations (stripped here, rendered by citations.js)
 */

import { safeHref, quranUrl } from './sources.js';
import { findHadithByMatan } from './dataset.js';
import { gradingInfo } from './citations.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * Card shown beneath every Arabic hadith block. Every field comes from the
 * dataset row (book name, volume, book, chapter, hadith number, grade, link),
 * never from the model's text.
 */
export function hadithCardHtml(rec) {
  const grade = gradingInfo(rec.grade);
  const url = safeHref(rec.url);
  const vol = rec.volume ? ` · Vol. ${rec.volume}` : '';
  return `<div class="hcard" dir="ltr" lang="en">
    <div class="hcard__meta">
      <span class="hcard__book">${esc(rec.collectionEn)}${esc(vol)}</span>
      <span class="hcard__loc">Book ${rec.b} · Chapter ${rec.ch}${rec.chapterTitle ? ` — ${esc(rec.chapterTitle)}` : ''}</span>
      <span class="hcard__num">Hadith #${rec.h}</span>
    </div>
    <div class="hcard__foot">
      ${grade ? `<span class="tag tag--${grade.cls || 'warn'}">${esc(grade.label)}</span>` : '<span class="tag">Grade not stated</span>'}
      ${url ? `<a class="hcard__btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ Thaqalayn پر کھولیں</a>` : ''}
    </div>
  </div>`;
}

/** Shown when an Arabic block cannot be matched to any dataset record. */
export const UNVERIFIED_CARD = `<div class="hcard hcard--warn" dir="rtl" lang="ur">
    <div class="hcard__meta"><span class="hcard__loc">⚠ غیر تصدیق شدہ — اس متن کا ڈیٹا بیس میں ریکارڈ نہیں ملا، اس لیے لنک نہیں دیا گیا۔</span></div>
  </div>`;

const RE_FENCE = /^\s*(?:```|~~~)\s*([A-Za-z0-9_-]*)\s*$/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_UL = /^(\s*)[-*+]\s+(.*)$/;
const RE_OL = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const RE_TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const RE_TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/* Urdu-only letters that never appear in Arabic — used to tell the two apart. */
const URDU_ONLY = /[ٹڈڑژچگپنےۓھ]/;
const ARABIC_LETTER = /[؀-ۿ]/;
const HARAKAT = /[ؐ-ًؚ-ٰٟۖ-ۭ]/;

function looksArabic(s) {
  const str = String(s || '');
  if (str.length < 12) return false;
  if (URDU_ONLY.test(str)) return false;
  let letters = 0;
  let harakat = 0;
  for (const ch of str) {
    if (ARABIC_LETTER.test(ch)) letters += 1;
    if (HARAKAT.test(ch)) harakat += 1;
  }
  if (!letters) return false;
  const ratio = letters / str.replace(/\s+/g, '').length;
  return ratio > 0.55 && (harakat >= 2 || /ـ/.test(str));
}

/* ── Inline ──────────────────────────────────────────────────── */

function inline(text, msgId) {
  const codes = [];
  let t = String(text ?? '').replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push(c);
    return `\uE000${codes.length - 1}\uE000`;
  });

  t = esc(t);

  // [text](url)
  // Only absolute https links on allowed hosts survive; anything else (e.g.
  // "thaqalayn:24/…") is shown as plain text.
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const ok = safeHref(href.replace(/&amp;/g, '&'));
    return ok ? `<a href="${esc(ok)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });

  // **bold** / __bold__ / *italic* / ~~del~~
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // inline citation marker [1] → jump anchor
  t = t.replace(
    /\[(\d{1,2})\]/g,
    (_m, n) =>
      `<a class="cite" href="#${msgId}-ref-${n}" data-cite="${n}" title="حوالہ ${n}">${n}</a>`
  );

  // bare links
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, url) => {
    const ok = safeHref(url.replace(/&amp;/g, '&'));
    return ok ? `${pre}<a href="${esc(ok)}" target="_blank" rel="noopener noreferrer">${url}</a>` : `${pre}${url}`;
  });

  // restore code spans
  t = t.replace(/\uE000(\d+)\uE000/g, (_m, i) => `<code>${esc(codes[Number(i)])}</code>`);

  return t;
}

/** Wrap Arabic-looking runs (outside of tags) in an Arabic span. */
function autoArabic(html) {
  return html.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, txt) => {
    if (tag) return tag;
    if (!txt || !looksArabic(txt)) return txt;
    const trimmed = txt.trim();
    if (!trimmed) return txt;
    const lead = txt.slice(0, txt.indexOf(trimmed[0]));
    const tail = txt.slice(lead.length + trimmed.length);
    return `${lead}<span class="ar-inline" lang="ar" dir="rtl">${trimmed}</span>${tail}`;
  });
}

/* ── Lists ───────────────────────────────────────────────────── */

function listIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].replace(/\t/g, '  ').length : 0;
}

function buildList(items, msgId) {
  // items: [{indent, ordered, text}]
  const root = { children: [] };
  const stack = [{ indent: -1, node: root }];

  for (const it of items) {
    const node = { ordered: it.ordered, text: it.text, children: [] };
    while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent: it.indent, node });
  }

  const render = (nodes, ordered) => {
    const tag = ordered ? 'ol' : 'ul';
    const body = nodes
      .map((n) => {
        const kids = n.children.length ? render(n.children, n.ordered) : '';
        return `<li>${inline(n.text, msgId)}${kids}</li>`;
      })
      .join('');
    return `<${tag}>${body}</${tag}>`;
  };

  return render(root.children, root.children[0]?.ordered ?? false);
}

/* ── Block parser ────────────────────────────────────────────── */

export function renderMarkdown(source, { msgId = 'm', refs = [] } = {}) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const refUrls = new Map(refs.map((r) => [String(r.n), r]));
  const skipArabic = new Set(); // indices of blocks already in an Arabic face

  while (i < lines.length) {
    const line = lines[i];

    // ── blank
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // ── fenced block
    const fence = line.match(RE_FENCE);
    if (fence) {
      const lang = (fence[1] || '').toLowerCase();
      const buf = [];
      i += 1;
      while (i < lines.length && !RE_FENCE.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence

      if (lang === 'refs' || lang === 'json') {
        // handled by citations.js — never shown as raw text
      } else if (lang === 'ar' || lang === 'arabic') {
        skipArabic.add(out.length);
        // Match the Arabic block to the dataset: show the EXACT matan and attach
        // the record's metadata card. No match → visibly unverified, no link.
        const rec = findHadithByMatan(buf.join('\n'));
        if (rec) {
          out.push(
            `<div class="ar-block" lang="ar" dir="rtl">${esc(rec.ar).replace(/\n/g, '<br>')}</div>${hadithCardHtml(rec)}`
          );
        } else {
          out.push(
            `<div class="ar-block ar-block--unverified" lang="ar" dir="rtl">${esc(buf.join('\n')).replace(/\n/g, '<br>')}</div>${UNVERIFIED_CARD}`
          );
        }
      } else if (lang === 'q' || lang === 'quran') {
        skipArabic.add(out.length);
        let body = buf.join('\n').trimEnd();
        let refLine = '';
        const m = body.match(/\n?\s*(\d{1,3})\s*:\s*(\d{1,3})\s*$/);
        if (m) {
          const qUrl = safeHref(quranUrl(Number(m[1]), Number(m[2])));
          refLine = `<span class="q-ref">Qurʾān ${m[1]}:${m[2]}${qUrl ? ` · <a href="${esc(qUrl)}" target="_blank" rel="noopener noreferrer">Thaqalayn</a>` : ''}</span>`;
          body = body.slice(0, m.index).trimEnd();
        }
        out.push(
          `<div class="q-block" lang="ar" dir="rtl">${esc(body).replace(/\n/g, '<br>')}${refLine}</div>`
        );
      } else if (lang === 'tr' || lang === 'tarjuma') {
        out.push(`<div class="tr-block">${inline(buf.join('\n'), msgId)}</div>`);
      } else {
        out.push(`<pre><code data-lang="${esc(lang)}">${esc(buf.join('\n'))}</code></pre>`);
      }
      continue;
    }

    // ── heading
    const h = line.match(RE_HEADING);
    if (h) {
      const level = Math.min(Math.max(h[1].length, 2), 4);
      out.push(`<h${level}>${inline(h[2], msgId)}</h${level}>`);
      i += 1;
      continue;
    }

    // ── hr
    if (RE_HR.test(line) && !RE_UL.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // ── blockquote
    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(lines[i].match(RE_QUOTE)[1]);
        i += 1;
      }
      out.push(
        `<blockquote>${renderMarkdown(buf.join('\n'), { msgId, refs })}</blockquote>`
      );
      continue;
    }

    // ── table
    if (RE_TABLE_ROW.test(line) && RE_TABLE_SEP.test(lines[i + 1] || '')) {
      const cells = (row) =>
        row
          .match(RE_TABLE_ROW)[1]
          .split('|')
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && RE_TABLE_ROW.test(lines[i])) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      out.push(
        `<table><thead><tr>${head
          .map((c) => `<th>${inline(c, msgId)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, msgId)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
      continue;
    }

    // ── list
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const ul = l.match(RE_UL);
        const ol = l.match(RE_OL);
        if (ul) items.push({ indent: listIndent(l), ordered: false, text: ul[2] });
        else if (ol) items.push({ indent: listIndent(l), ordered: true, text: ol[3] });
        else if (l.trim() && listIndent(l) >= 2 && items.length) {
          items[items.length - 1].text += `\n${l.trim()}`;
        } else break;
        i += 1;
      }
      out.push(buildList(items, msgId));
      continue;
    }

    // ── paragraph
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !RE_FENCE.test(lines[i]) &&
      !RE_HEADING.test(lines[i]) &&
      !RE_QUOTE.test(lines[i]) &&
      !RE_UL.test(lines[i]) &&
      !RE_OL.test(lines[i]) &&
      !(RE_TABLE_ROW.test(lines[i]) && RE_TABLE_SEP.test(lines[i + 1] || ''))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    if (buf.length) {
      const para = inline(buf.join('\n'), msgId);
      out.push(`<p>${para.replace(/\n/g, '<br>')}</p>`);
    }
  }

  const html = out
    .map((block, idx) => (skipArabic.has(idx) ? block : autoArabic(block)))
    .join('\n');
  void refUrls;
  return html;
}

/** Plain-text version of a markdown answer (used for copy + export). */
export function toPlainText(md) {
  return String(md ?? '')
    .replace(/```refs[\s\S]*?```/gi, '')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) =>
      lang === 'refs' ? '' : `\n${code.trim()}\n`
    )
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[(\d{1,2})\]/g, '[$1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim();
}
