import { describe, expect, it } from 'vitest';
import {
  base64Length,
  classifyFile,
  compactText,
  decodeEntities,
  DOCX_MIME,
  htmlToText,
  INLINE_PAYLOAD_LIMIT_BYTES,
  looksLikeHtml,
  shouldUseFilesApi,
} from './documents.ts';

describe('classifyFile', () => {
  it('recognizes supported types by MIME', () => {
    expect(classifyFile('application/pdf', 'a.pdf')).toEqual({ kind: 'pdf', mediaType: 'application/pdf' });
    expect(classifyFile('image/jpeg', 'p.jpg')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(classifyFile('image/jpg', 'p.jpg')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(classifyFile('image/png', 'p.png')).toEqual({ kind: 'image', mediaType: 'image/png' });
    expect(classifyFile('image/webp', 'p.webp')).toEqual({ kind: 'image', mediaType: 'image/webp' });
    expect(classifyFile('image/gif', 'p.gif')).toEqual({ kind: 'image', mediaType: 'image/gif' });
    expect(classifyFile(DOCX_MIME, 'syllabus.docx')).toEqual({ kind: 'docx' });
    expect(classifyFile('text/plain; charset=utf-8', 'notes.txt')).toEqual({ kind: 'text' });
  });

  it('falls back to the extension for generic MIME types', () => {
    expect(classifyFile('application/octet-stream', 'Syllabus.PDF')).toEqual({ kind: 'pdf', mediaType: 'application/pdf' });
    expect(classifyFile('', 'scan.jpeg')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(classifyFile('', 'syllabus.docx')).toEqual({ kind: 'docx' });
  });

  it('rejects HEIC and other formats with an actionable message', () => {
    const heic = classifyFile('image/heic', 'IMG_0042.HEIC');
    expect(heic.kind).toBe('unsupported');
    if (heic.kind === 'unsupported') expect(heic.message).toMatch(/HEIC.*JPEG/);
    const heicByName = classifyFile('application/octet-stream', 'IMG_0042.heic');
    expect(heicByName.kind).toBe('unsupported');
    const doc = classifyFile('application/msword', 'old.doc');
    expect(doc.kind === 'unsupported' && doc.message).toMatch(/\.docx/);
    const pages = classifyFile('application/x-iwork-pages-sffpages', 'syllabus.pages');
    expect(pages.kind === 'unsupported' && pages.message).toMatch(/syllabus\.pages/);
  });
});

describe('payload sizing', () => {
  it('computes base64 length', () => {
    expect(base64Length(0)).toBe(0);
    expect(base64Length(1)).toBe(4);
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
  });

  it('switches to the Files API above the inline limit', () => {
    expect(shouldUseFilesApi([1_000_000, 2_000_000], 50_000)).toBe(false);
    const justUnder = Math.floor((INLINE_PAYLOAD_LIMIT_BYTES / 4) * 3) - 3;
    expect(shouldUseFilesApi([justUnder], 0)).toBe(false);
    expect(shouldUseFilesApi([justUnder], 100)).toBe(true);
    expect(shouldUseFilesApi([20 * 1024 * 1024], 0)).toBe(true);
  });
});

describe('compactText', () => {
  it('normalizes whitespace and blank lines', () => {
    expect(compactText('  Week 1\r\n\r\n\r\n\tIntro   to   Psych ​\n\n\n\nEnd  ')).toBe('Week 1\n\nIntro to Psych\n\nEnd');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities once', () => {
    expect(decodeEntities('A &amp; B &lt;3 &#8211; &#x2014; &rsquo;s &nbsp;x &unknown;')).toBe("A & B <3 – — ’s  x &unknown;");
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('looksLikeHtml', () => {
  it('detects markup', () => {
    expect(looksLikeHtml('<p>Hello</p>')).toBe(true);
    expect(looksLikeHtml('Grades: A > 90, B < 90')).toBe(false);
  });
});

describe('htmlToText', () => {
  it('keeps schedule table rows readable as one line per row', () => {
    const html = `
      <h2>Course   Schedule</h2>
      <table border="1">
        <thead><tr><th>Week</th><th>Date</th><th>Topic</th><th>Due</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Aug 25</td><td><p>Intro</p><p>Read <strong>Ch. 1&ndash;2</strong></p></td><td></td></tr>
          <tr>
            <td>2</td>
            <td>Sep 1</td>
            <td>No class &mdash; Labor Day</td>
            <td>Quiz 1<br>HW 1</td>
          </tr>
        </tbody>
      </table>`;
    expect(htmlToText(html)).toBe(
      ['## Course Schedule', '', 'Week | Date | Topic | Due', '1 | Aug 25 | Intro Read Ch. 1–2 |', '2 | Sep 1 | No class — Labor Day | Quiz 1 / HW 1'].join('\n'),
    );
  });

  it('formats headings, paragraphs, lists, and line breaks', () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head><body>
      <h1>PSY 101</h1><p>Instructor: Dr.&nbsp;Lee<br/>Email: lee@school.edu</p>
      <ul><li>Midterm &ndash; 30%</li><li>Final &ndash; 40%</li><li></li></ul>
      <script>alert(1)</script><!-- hidden --><div>Office hours: <em>Tue</em> 2&ndash;4pm</div></body></html>`;
    expect(htmlToText(html)).toBe(
      ['# PSY 101', '', 'Instructor: Dr. Lee', 'Email: lee@school.edu', '', '- Midterm – 30%', '- Final – 40%', '', 'Office hours: Tue 2–4pm'].join('\n'),
    );
  });

  it('drops images, scripts, and comments entirely', () => {
    expect(htmlToText('<p>A<img src="data:image/png;base64,AAAA" alt="x">B</p><!-- <p>secret</p> --><script>var s = "<p>x</p>";</script>')).toBe('A B');
  });

  it('skips rows whose cells are all empty', () => {
    expect(htmlToText('<table><tr><td> </td><td>&nbsp;</td></tr><tr><td>Exam</td><td>Oct 3</td></tr></table>')).toBe('Exam | Oct 3');
  });
});
