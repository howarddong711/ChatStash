import katex from 'katex';
import fontkit from '@pdf-lib/fontkit';
import { marked } from 'marked';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

import type { Conversation } from '@/shared/types';
import notoSansScBoldUrl from '@/assets/fonts/NotoSansHans-Bold.otf?url';
import notoSansScRegularUrl from '@/assets/fonts/NotoSansHans-Regular.otf?url';

// ── Models & Constants ───────────────────────────────────────────────────────

type RenderContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  fonts: { cjk: PDFFont; bold: PDFFont; mono: PDFFont };
  cursor: { top: number };
  margin: { left: number; right: number; top: number; bottom: number };
};

type Style = { font: PDFFont; size: number; color: RGB; bg?: RGB };
type InlineChunk = Style & { text: string };

let regularFontCache: Uint8Array | null = null;
let boldFontCache: Uint8Array | null = null;

// ── Math & Text Utilities ────────────────────────────────────────────────────

function toSuper(text: string): string {
  const map: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ'
  };
  return Array.from(text).map(c => map[c] || c).join('');
}

function toSub(text: string): string {
  const map: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎'
  };
  return Array.from(text).map(c => map[c] || c).join('');
}

function mathToReadable(latex: string): string {
  const map: Record<string, string> = {
    '\\leftarrow': '←', '\\rightarrow': '→', '\\quad': '  ', '\\pi': 'π', '\\theta': 'θ',
    '\\mathcal{T}': 'T', '\\mathcal': '', '\\text': '', '\\cdot': '·', '\\infty': '∞',
    '\\le': '≤', '\\ge': '≥', '\\ne': '≠', '\\approx': '≈', '\\times': '×', '\\div': '÷',
    '\\pm': '±', '\\sum': 'Σ', '\\prod': 'Π', '\\int': '∫', '\\delta': 'δ', '\\Delta': 'Δ',
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\epsilon': 'ε', '\\sigma': 'σ', '\\omega': 'ω',
    '\\nabla': '∇', '\\partial': '∂', '\\forall': '∀', '\\exists': '∃', '\\in': '∈', '\\notin': '∉',
    '\\cup': '∪', '\\cap': '∩', '\\subset': '⊂', '\\supset': '⊃', '\\subseteq': '⊆', '\\supseteq': '⊇',
    '\\sqrt': '√', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥'
  };
  let out = latex.trim();
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v);
  }
  
  // Basic heuristic for sub/superscripts
  out = out.replace(/_\{([^}]+)\}/g, (_, p1) => toSub(p1));
  out = out.replace(/\^\{([^}]+)\}/g, (_, p1) => toSuper(p1));
  out = out.replace(/_([0-9a-zA-Z])/g, (_, p1) => toSub(p1));
  out = out.replace(/\^([0-9a-zA-Z])/g, (_, p1) => toSuper(p1));
  
  return out.replace(/[{}]/g, '');
}

function replaceMath(text: string): string {
  let out = text;
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_, g1) => ` [ ${mathToReadable(g1)} ] `);
  out = out.replace(/\$([^\n$]+?)\$/g, (_, g1) => mathToReadable(g1));
  // Handle loose LaTeX
  out = out.replace(/(\\[A-Za-z]+[\s\S]{0,100}?[_^{}])(?=(?:\s|$|。|；|;|，|,))/g, m => mathToReadable(m));
  return out;
}

// ── Asset Loading ────────────────────────────────────────────────────────────

async function loadFontBytes(url: string): Promise<Uint8Array> {
  const fullUrl = /^(https?:|data:|blob:|chrome-extension:)/i.test(url) ? url : chrome.runtime.getURL(url.startsWith('/') ? url.slice(1) : url);
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`Font load failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function getEmbeddedFonts(pdfDoc: PDFDocument): Promise<RenderContext['fonts']> {
  pdfDoc.registerFontkit(fontkit);
  if (!regularFontCache) regularFontCache = await loadFontBytes(notoSansScRegularUrl);
  if (!boldFontCache) {
    try { boldFontCache = await loadFontBytes(notoSansScBoldUrl); } catch { boldFontCache = null; }
  }
  const cjk = await pdfDoc.embedFont(regularFontCache, { subset: true });
  const bold = boldFontCache ? await pdfDoc.embedFont(boldFontCache, { subset: true }) : await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);
  return { cjk, bold, mono };
}

// ── Layout Engine ────────────────────────────────────────────────────────────

function checkPage(ctx: RenderContext, h: number) {
  if (ctx.cursor.top + h > ctx.margin.bottom) {
    ctx.page = ctx.pdfDoc.addPage([595.28, 841.89]);
    ctx.cursor.top = ctx.margin.top;
  }
}

function drawInline(chunks: InlineChunk[], ctx: RenderContext, left: number, lineHeight: number) {
  let curX = left;
  for (const chunk of chunks) {
    let txt = chunk.text;
    while (txt.length > 0) {
      const availW = ctx.margin.right - curX;
      let fit = 0, curW = 0;
      for (let i = 0; i < txt.length; i++) {
        const charW = chunk.font.widthOfTextAtSize(txt[i], chunk.size);
        if (curW + charW > availW && fit > 0) break;
        curW += charW; fit++;
      }
      const segment = txt.slice(0, fit);
      const segW = chunk.font.widthOfTextAtSize(segment, chunk.size);
      checkPage(ctx, lineHeight);
      if (chunk.bg) {
        ctx.page.drawRectangle({ x: curX, y: ctx.page.getHeight() - ctx.cursor.top - chunk.size * 1.15, width: segW, height: chunk.size * 1.4, color: chunk.bg });
      }
      ctx.page.drawText(segment, { x: curX, y: ctx.page.getHeight() - ctx.cursor.top - chunk.size, font: chunk.font, size: chunk.size, color: chunk.color });
      curX += segW; txt = txt.slice(fit);
      if (txt.length > 0) { ctx.cursor.top += lineHeight; curX = left; }
    }
  }
  ctx.cursor.top += lineHeight;
}

function extractInline(tokens: any[] | undefined, style: Style, ctx: RenderContext): InlineChunk[] {
  const out: InlineChunk[] = [];
  if (!tokens) return out;
  for (const t of tokens) {
    if (t.type === 'strong') out.push(...extractInline(t.tokens, { ...style, font: ctx.fonts.bold }, ctx));
    else if (t.type === 'codespan') out.push({ text: t.text, font: ctx.fonts.mono, size: style.size - 1, color: rgb(0.6, 0.2, 0.3), bg: rgb(0.96, 0.96, 0.96) });
    else if (t.type === 'link') out.push(...extractInline(t.tokens, { ...style, color: rgb(0.05, 0.35, 0.75) }, ctx));
    else if (t.type === 'text' || t.type === 'escape') out.push({ text: t.text, ...style });
    else if (t.type === 'space') out.push({ text: ' ', ...style });
    else out.push({ text: t.raw, ...style });
  }
  return out;
}

function renderBlocks(blocks: any[], ctx: RenderContext, left: number) {
  for (const b of blocks) {
    if (b.type === 'space' || b.type === 'hr') { ctx.cursor.top += 10; continue; }
    if (b.type === 'heading') {
      ctx.cursor.top += 12;
      const size = Math.max(12, 22 - b.depth * 2);
      drawInline(extractInline(b.tokens, { font: ctx.fonts.bold, size, color: rgb(0.1, 0.1, 0.1) }, ctx), ctx, left, size * 1.5);
      ctx.cursor.top += 4;
    } else if (b.type === 'paragraph' || b.type === 'text') {
      drawInline(extractInline(b.tokens, { font: ctx.fonts.cjk, size: 11, color: rgb(0.15, 0.15, 0.15) }, ctx), ctx, left, 11 * 1.6);
      ctx.cursor.top += 4;
    } else if (b.type === 'list') {
      b.items.forEach((it: any, i: number) => {
        const bullet = b.ordered ? `${b.start + i}. ` : '• ';
        checkPage(ctx, 16);
        const itemTop = ctx.cursor.top;
        ctx.page.drawText(bullet, { x: left, y: ctx.page.getHeight() - itemTop - 11, font: ctx.fonts.bold, size: 11, color: rgb(0.2, 0.2, 0.2) });
        renderBlocks(it.tokens || [], ctx, left + 18);
        ctx.cursor.top += 2;
      });
    } else if (b.type === 'blockquote') {
      const startY = ctx.cursor.top;
      renderBlocks(b.tokens || [], ctx, left + 16);
      ctx.page.drawLine({ start: { x: left + 6, y: ctx.page.getHeight() - startY + 2 }, end: { x: left + 6, y: ctx.page.getHeight() - ctx.cursor.top + 6 }, thickness: 4, color: rgb(0.44, 0.27, 0.13) });
      ctx.cursor.top += 6;
    } else if (b.type === 'code') {
      const lines = b.text.split('\n'), size = 9, lh = 14;
      const blockWidth = ctx.margin.right - left;
      const padding = 8;
      
      ctx.cursor.top += 4;
      checkPage(ctx, padding + lh);
      
      if (b.lang) {
        ctx.page.drawText(b.lang.toUpperCase(), { 
          x: ctx.margin.right - ctx.fonts.bold.widthOfTextAtSize(b.lang, 7) - 10, 
          y: ctx.page.getHeight() - ctx.cursor.top - 10, 
          font: ctx.fonts.bold, size: 7, color: rgb(0.6, 0.6, 0.6) 
        });
      }

      for (let i = 0; i < lines.length; i++) {
        const isFirst = i === 0;
        const isLast = i === lines.length - 1;
        const lineNeeded = lh + (isLast ? padding : 0);
        
        checkPage(ctx, lineNeeded);
        
        const topPadding = isFirst ? padding : 0;
        const bottomPadding = isLast ? padding : 0;
        const totalLineH = lh + topPadding + bottomPadding;
        
        ctx.page.drawRectangle({
          x: left,
          y: ctx.page.getHeight() - ctx.cursor.top - lh - bottomPadding,
          width: blockWidth,
          height: totalLineH,
          color: rgb(0.96, 0.96, 0.96)
        });
        ctx.page.drawLine({
          start: { x: left, y: ctx.page.getHeight() - ctx.cursor.top + topPadding },
          end: { x: left, y: ctx.page.getHeight() - ctx.cursor.top - lh - bottomPadding },
          thickness: 3,
          color: rgb(0.44, 0.27, 0.13)
        });

        ctx.page.drawText(lines[i], {
          x: left + 12,
          y: ctx.page.getHeight() - ctx.cursor.top - lh + 2,
          font: ctx.fonts.mono,
          size,
          color: rgb(0.2, 0.2, 0.2)
        });
        ctx.cursor.top += lh;
      }
      ctx.cursor.top += padding + 8;
      ctx.cursor.top += padding + 8;
    } else if (b.type === 'hr') {
      ctx.cursor.top += 12;
      checkPage(ctx, 4);
      ctx.page.drawLine({
        start: { x: left, y: ctx.page.getHeight() - ctx.cursor.top },
        end: { x: ctx.margin.right, y: ctx.page.getHeight() - ctx.cursor.top },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8)
      });
      ctx.cursor.top += 12;
    } else if (b.type === 'table') {
      const fontSize = 9;
      const lh = 14;
      const colPadding = 8;
      
      const numCols = b.header.length;
      const colWidths = new Array(numCols).fill(40); // min width 40
      
      const getCellWidth = (tokens: any[]) => {
        const chunks = extractInline(tokens, { font: ctx.fonts.cjk, size: fontSize, color: rgb(0,0,0) }, ctx);
        let w = 0;
        for (const c of chunks) w += c.font.widthOfTextAtSize(c.text, c.size);
        return w;
      };

      b.header.forEach((h: any, i: number) => {
        colWidths[i] = Math.max(colWidths[i], getCellWidth(h.tokens));
      });
      b.rows.forEach((row: any[]) => {
        row.forEach((cell: any, i: number) => {
          colWidths[i] = Math.max(colWidths[i], getCellWidth(cell.tokens));
        });
      });

      const totalTableW = colWidths.reduce((a, b) => a + b, 0) + (numCols * colPadding * 2);
      const availTableW = ctx.margin.right - left;
      
      if (totalTableW > availTableW) {
        const scale = availTableW / totalTableW;
        for (let i = 0; i < numCols; i++) colWidths[i] *= scale;
      }

      const drawRow = (cells: any[], isHeader: boolean) => {
        const rowPadding = 4;
        const rowH = lh + rowPadding * 2;
        checkPage(ctx, rowH);
        const rowTop = ctx.cursor.top;
        let curX = left;
        
        if (isHeader) {
          ctx.page.drawRectangle({
            x: left, y: ctx.page.getHeight() - rowTop - rowH,
            width: availTableW, height: rowH,
            color: rgb(0.96, 0.96, 0.96)
          });
        }

        cells.forEach((cell: any, i: number) => {
          const cellW = (colWidths[i] * (totalTableW > availTableW ? (availTableW/totalTableW) : 1)) + colPadding * 2;
          const chunks = extractInline(cell.tokens, { 
            font: isHeader ? ctx.fonts.bold : ctx.fonts.cjk, 
            size: fontSize, 
            color: rgb(0.1, 0.1, 0.1) 
          }, ctx);
          
          let cellCurX = curX + colPadding;
          for (const chunk of chunks) {
            const txtW = chunk.font.widthOfTextAtSize(chunk.text, chunk.size);
            if (cellCurX + txtW > curX + cellW - 2) break; 
            ctx.page.drawText(chunk.text, {
              x: cellCurX, y: ctx.page.getHeight() - rowTop - rowPadding - fontSize + 1,
              font: chunk.font, size: chunk.size, color: chunk.color
            });
            cellCurX += txtW;
          }
          
          ctx.page.drawLine({
            start: { x: curX, y: ctx.page.getHeight() - rowTop },
            end: { x: curX, y: ctx.page.getHeight() - rowTop - rowH },
            thickness: 0.5, color: rgb(0.8, 0.8, 0.8)
          });
          curX += cellW;
        });
        
        ctx.page.drawLine({
          start: { x: curX, y: ctx.page.getHeight() - rowTop },
          end: { x: curX, y: ctx.page.getHeight() - rowTop - rowH },
          thickness: 0.5, color: rgb(0.8, 0.8, 0.8)
        });
        
        ctx.page.drawLine({
          start: { x: left, y: ctx.page.getHeight() - rowTop - rowH },
          end: { x: curX, y: ctx.page.getHeight() - rowTop - rowH },
          thickness: 0.5, color: rgb(0.8, 0.8, 0.8)
        });

        ctx.cursor.top += rowH;
      };

      ctx.page.drawLine({
        start: { x: left, y: ctx.page.getHeight() - ctx.cursor.top },
        end: { x: ctx.margin.right, y: ctx.page.getHeight() - ctx.cursor.top },
        thickness: 0.5, color: rgb(0.8, 0.8, 0.8)
      });

      drawRow(b.header.map((h: any) => ({ tokens: h.tokens })), true);
      b.rows.forEach((row: any[]) => drawRow(row.map(c => ({ tokens: c.tokens })), false));
      ctx.cursor.top += 8;
    }
  }
}

export async function conversationToPdfBlob(conversation: Conversation): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getEmbeddedFonts(pdfDoc);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const ctx: RenderContext = { pdfDoc, page, fonts, cursor: { top: 40 }, margin: { left: 40, right: 555, top: 40, bottom: 801 } };
  
  drawInline([{ text: conversation.title || 'Chat Export', font: fonts.bold, size: 20, color: rgb(0, 0, 0) }], ctx, 40, 28);
  drawInline([{ text: `${conversation.platform.toUpperCase()} · ${conversation.exportedAt}`, font: fonts.cjk, size: 10, color: rgb(0.4, 0.4, 0.4) }], ctx, 40, 16);
  ctx.cursor.top += 12;

  for (const turn of conversation.turns) {
    checkPage(ctx, 40);
    const isAssistant = turn.role === 'assistant';
    const roleCol = isAssistant ? rgb(0.44, 0.27, 0.13) : rgb(0.2, 0.2, 0.2);
    const bgCol = isAssistant ? rgb(0.98, 0.96, 0.94) : rgb(0.96, 0.96, 0.96);
    const headerH = 24;
    ctx.page.drawRectangle({ x: 40, y: ctx.page.getHeight() - ctx.cursor.top - headerH + 4, width: ctx.margin.right - 40, height: headerH, color: bgCol });
    ctx.page.drawLine({ start: { x: 40, y: ctx.page.getHeight() - ctx.cursor.top + 4 }, end: { x: 40, y: ctx.page.getHeight() - ctx.cursor.top - headerH + 4 }, thickness: 4, color: roleCol });
    
    // Role Indicator Circle (Visual alignment with high-quality exports)
    ctx.page.drawCircle({
      x: 55, y: ctx.page.getHeight() - ctx.cursor.top - headerH/2 + 4,
      size: 5,
      color: roleCol
    });

    drawInline([{ text: (isAssistant ? 'Assistant' : 'User').toUpperCase(), font: fonts.bold, size: 10, color: roleCol }], ctx, 70, 20);
    ctx.cursor.top += 8;

    const md = replaceMath((turn.contentMd || turn.contentText || '').trim()
      .replace(/([^\n])(#{1,6}\s)/g, '$1\n\n$2')
      .replace(/([^\n])([\n\r]*)([-*+]\s|\d+\.\s)/g, (m,p1,p2,p3)=>p2.includes('\n')?m:`${p1}\n\n${p3}`)
    );
    renderBlocks(marked.lexer(md, { gfm: true, breaks: true }), ctx, 40);
    ctx.cursor.top += 20;
  }

  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const p = pdfDoc.getPage(i);
    const text = `Page ${i + 1} of ${totalPages}`;
    const fontSize = 9;
    const textWidth = fonts.cjk.widthOfTextAtSize(text, fontSize);
    p.drawText(text, {
      x: p.getWidth() / 2 - textWidth / 2,
      y: 20,
      font: fonts.cjk,
      size: fontSize,
      color: rgb(0.5, 0.5, 0.5),
    });
  }
  const bytes = await pdfDoc.save();
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}