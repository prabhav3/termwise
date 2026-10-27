// Validates the CanvasRequest union (supabase/functions/_shared/api.ts) from an untrusted body.
import type { CanvasRequest } from '../_shared/api.ts';
import { HttpError } from '../_shared/http.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANVAS_ID_RE = /^[0-9]{1,20}$|^[0-9]{1,20}~[0-9]{1,20}$/;
const MAX_IMPORT_COURSES = 20;

type Body = Record<string, unknown>;

function uuid(body: Body, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError('bad_request', `${field} is required.`);
  return value;
}

function optionalUuid(body: Body, field: string): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError('bad_request', `${field} must be an id.`);
  return value;
}

function canvasId(value: unknown): string {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !CANVAS_ID_RE.test(id.trim())) throw new HttpError('bad_request', 'external_id must be a Canvas course id.');
  return id.trim();
}

export function parseCanvasRequest(raw: unknown): CanvasRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError('bad_request', 'Request body must be an object.');
  const body = raw as Body;
  switch (body.action) {
    case 'connect': {
      const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : '';
      const token = typeof body.access_token === 'string' ? body.access_token.trim() : '';
      if (!baseUrl || baseUrl.length > 300) throw new HttpError('bad_request', 'Enter your school’s Canvas address.');
      if (token.length < 10 || token.length > 512 || /\s/.test(token)) {
        throw new HttpError('bad_request', 'That access token doesn’t look right. Copy it again from Canvas → Account → Settings.');
      }
      return { action: 'connect', base_url: baseUrl, access_token: token };
    }
    case 'list_courses':
    case 'sync':
    case 'disconnect':
      return { action: body.action, connection_id: uuid(body, 'connection_id') };
    case 'fetch_syllabus':
      return { action: 'fetch_syllabus', connection_id: uuid(body, 'connection_id'), external_id: canvasId(body.external_id) };
    case 'import': {
      const connectionId = uuid(body, 'connection_id');
      if (!Array.isArray(body.courses) || body.courses.length === 0) throw new HttpError('bad_request', 'Pick at least one course to import.');
      if (body.courses.length > MAX_IMPORT_COURSES) throw new HttpError('bad_request', `Import at most ${MAX_IMPORT_COURSES} courses at a time.`);
      const seen = new Set<string>();
      const courses = body.courses.map((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) throw new HttpError('bad_request', 'Each course needs an external_id.');
        const course = entry as Body;
        const externalId = canvasId(course.external_id);
        if (seen.has(externalId)) throw new HttpError('bad_request', 'A course was listed twice.');
        seen.add(externalId);
        return { external_id: externalId, link_course_id: optionalUuid(course, 'link_course_id'), term_id: optionalUuid(course, 'term_id') };
      });
      const linkIds = courses.map((c) => c.link_course_id).filter((id): id is string => id !== null);
      if (new Set(linkIds).size !== linkIds.length) throw new HttpError('bad_request', 'Two Canvas courses can’t be linked to the same Termwise course.');
      if (body.include_scores !== undefined && typeof body.include_scores !== 'boolean') {
        throw new HttpError('bad_request', 'include_scores must be true or false.');
      }
      return { action: 'import', connection_id: connectionId, courses, include_scores: body.include_scores ?? true };
    }
    default:
      throw new HttpError('bad_request', 'Unknown action.');
  }
}
