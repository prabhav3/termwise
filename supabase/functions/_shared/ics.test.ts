import { describe, expect, it } from 'vitest';
import { buildIcs, buildVTimezone, escapeText, findTransitions, foldLine, normalizeTzid, parseIcs, toLocal, unescapeText } from './ics.ts';

const encoder = new TextEncoder();

describe('text escaping and folding', () => {
  it('escapes and unescapes RFC 5545 text', () => {
    const raw = 'Read ch. 4; pages 1,2\nBring notes \\ pens';
    const escaped = escapeText(raw);
    expect(escaped).toBe('Read ch. 4\\; pages 1\\,2\\nBring notes \\\\ pens');
    expect(unescapeText(escaped)).toBe(raw);
  });

  it('folds at 75 octets without splitting multi-byte characters', () => {
    const line = `SUMMARY:${'★ Midterm Größe 📚 '.repeat(12)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(2);
    expect(encoder.encode(parts[0]).length).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
  });
});

describe('VTIMEZONE', () => {
  it('finds DST transitions to the minute', () => {
    const t = findTransitions('America/New_York', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(t.map((x) => new Date(x.atMs).toISOString())).toEqual(['2026-03-08T07:00:00.000Z', '2026-11-01T06:00:00.000Z']);
    expect(t.map((x) => [x.from, x.to])).toEqual([
      [-300, -240],
      [-240, -300],
    ]);
  });

  it('emits observances with local onset times', () => {
    const lines = buildVTimezone('America/New_York', 2026, 2026);
    expect(lines).toContain('TZID:America/New_York');
    const text = lines.join('\n');
    expect(text).toContain('BEGIN:DAYLIGHT\nDTSTART:20260308T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400');
    expect(text).toContain('BEGIN:STANDARD\nDTSTART:20261101T020000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500');
    expect(buildVTimezone('Asia/Kolkata', 2026, 2026).join('\n')).toContain('TZOFFSETTO:+0530');
  });
});

describe('buildIcs → parseIcs round trip', () => {
  const ics = buildIcs({
    prodId: '-//Termwise//Termwise//EN',
    name: 'Termwise',
    timeZone: 'America/New_York',
    refreshInterval: 'PT6H',
    dtstamp: '2026-10-27T12:00:00Z',
    events: [
      {
        uid: 'item-1@termwise.app',
        summary: '★ PSY 101: Midterm 1',
        start: { kind: 'date', date: '2026-11-03' },
        description: 'Exam · Worth 25% of PSY 101\nOpen in Termwise: termwise://item/1',
        url: 'termwise://item/1',
        categories: ['PSY 101', 'Exam'],
        transparent: true,
      },
      {
        uid: 'item-2@termwise.app',
        summary: 'BIO 210: Lab report, draft; v2',
        start: { kind: 'zoned', date: '2026-11-05', time: '16:00', tzid: 'America/New_York' },
        end: { kind: 'zoned', date: '2026-11-05', time: '16:30', tzid: 'America/New_York' },
      },
    ],
  });

  it('produces a well-formed calendar', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Termwise');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261103');
    expect(ics).toContain('DTEND;VALUE=DATE:20261104');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261105T160000');
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('DTSTAMP:20261027T120000Z');
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
  });

  it('parses back what it built', () => {
    const parsed = parseIcs(ics);
    expect(parsed.name).toBe('Termwise');
    expect(parsed.timeZone).toBe('America/New_York');
    expect(parsed.events).toHaveLength(2);
    const [a, b] = parsed.events;
    expect(a.uid).toBe('item-1@termwise.app');
    expect(a.summary).toBe('★ PSY 101: Midterm 1');
    expect(a.description).toBe('Exam · Worth 25% of PSY 101\nOpen in Termwise: termwise://item/1');
    expect(a.categories).toEqual(['PSY 101', 'Exam']);
    expect(a.start).toEqual({ kind: 'date', date: '2026-11-03' });
    expect(a.end).toEqual({ kind: 'date', date: '2026-11-04' });
    expect(a.url).toBe('termwise://item/1');
    expect(b.summary).toBe('BIO 210: Lab report, draft; v2');
    expect(b.start).toEqual({ kind: 'zoned', date: '2026-11-05', time: '16:00', tzid: 'America/New_York' });
    expect(toLocal(b.start!, 'America/Chicago')).toEqual({ date: '2026-11-05', time: '15:00' });
  });
});

describe('parseIcs tolerance', () => {
  it('handles LF endings, folding, UTC and Windows TZIDs, CATEGORIES, and nested alarms', () => {
    const feed = [
      'BEGIN:VCALENDAR',
      'X-WR-CALNAME:Moodle',
      'BEGIN:VEVENT',
      'UID:1@moodle',
      'SUMMARY:Assignment 1 is d',
      ' ue',
      'DTSTART:20261110T045900Z',
      'CATEGORIES:PSY101,Fall\\, 2026',
      'BEGIN:VALARM',
      'SUMMARY:Reminder',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:2@bb',
      'SUMMARY;LANGUAGE=en:Quiz 2',
      'DTSTART;TZID="Eastern Standard Time":20261112T090000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:Broken',
      'DTSTART:not-a-date',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const parsed = parseIcs(feed);
    expect(parsed.name).toBe('Moodle');
    expect(parsed.events).toHaveLength(3);
    const [a, b, c] = parsed.events;
    expect(a.summary).toBe('Assignment 1 is due');
    expect(a.categories).toEqual(['PSY101', 'Fall, 2026']);
    expect(a.start).toEqual({ kind: 'utc', instant: '2026-11-10T04:59:00Z' });
    expect(toLocal(a.start!, 'America/New_York')).toEqual({ date: '2026-11-09', time: '23:59' });
    expect(b.start).toEqual({ kind: 'zoned', date: '2026-11-12', time: '09:00', tzid: 'America/New_York' });
    expect(c.start).toBeNull();
  });

  it('reads floating times in the calendar zone and VALUE=DATE dates', () => {
    const parsed = parseIcs(
      'BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:Europe/Paris\r\nBEGIN:VEVENT\r\nSUMMARY:A\r\nDTSTART:20261110T120000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:B\r\nDTSTART;VALUE=DATE:20261111\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(parsed.events[0].start).toEqual({ kind: 'zoned', date: '2026-11-10', time: '12:00', tzid: 'Europe/Paris' });
    expect(parsed.events[1].start).toEqual({ kind: 'date', date: '2026-11-11' });
  });

  it('normalizes TZIDs', () => {
    expect(normalizeTzid('/America/New_York')).toBe('America/New_York');
    expect(normalizeTzid('Pacific Standard Time')).toBe('America/Los_Angeles');
    expect(normalizeTzid('Nowhere/Special')).toBeNull();
  });
});
