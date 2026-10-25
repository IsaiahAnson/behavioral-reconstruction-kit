import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: true });
const slug = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
const digest = '^[a-f0-9]{64}$';
const evidenceId = '^ev_[a-f0-9]{64}$';

const endpoint = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'version', 'base_url'],
  properties: {
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    base_url: { type: 'string', pattern: '^https?://' },
    artifact_sha256: { type: 'string', pattern: digest }
  }
};

export const targetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'id', 'original', 'candidate', 'claims'],
  properties: {
    schema: { const: 'reconstruction-target/v1' },
    id: { type: 'string', pattern: slug },
    original: endpoint,
    candidate: endpoint,
    environment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        viewport: {
          type: 'object',
          additionalProperties: false,
          required: ['width', 'height'],
          properties: {
            width: { type: 'integer', minimum: 320, maximum: 7680 },
            height: { type: 'integer', minimum: 240, maximum: 4320 }
          }
        },
        locale: { type: 'string', minLength: 2 },
        timezone_id: { type: 'string', minLength: 1 }
      }
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'required', 'case_ids', 'evidence_refs'],
        properties: {
          id: { type: 'string', pattern: slug },
          title: { type: 'string', minLength: 1 },
          required: { type: 'boolean' },
          case_ids: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: slug } },
          evidence_refs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'evidence_id'],
              properties: {
                file: { type: 'string', minLength: 1 },
                evidence_id: { type: 'string', pattern: evidenceId }
              }
            }
          },
          owner_path: { type: 'string', minLength: 1 }
        }
      }
    }
  }
};

const locator = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { enum: ['css', 'role', 'text', 'label', 'testid'] },
    selector: { type: 'string', minLength: 1 },
    role: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 }
  }
};

const observed = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'kind'],
  properties: {
    name: { type: 'string', pattern: slug },
    kind: { enum: ['text', 'value', 'visible', 'url_path', 'local_storage', 'screenshot'] },
    key: { type: 'string', minLength: 1 },
    locator,
    original_locator: locator,
    candidate_locator: locator
  }
};

export const caseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'id', 'title', 'initial_path', 'steps'],
  properties: {
    schema: { const: 'reconstruction-case/v1' },
    id: { type: 'string', pattern: slug },
    title: { type: 'string', minLength: 1 },
    initial_path: { type: 'string', pattern: '^/' },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'action', 'observations'],
        properties: {
          id: { type: 'string', pattern: slug },
          action: { enum: ['observe', 'click', 'fill', 'press', 'reload', 'navigate', 'wait_for'] },
          locator,
          original_locator: locator,
          candidate_locator: locator,
          value: { type: 'string' },
          path: { type: 'string', pattern: '^/' },
          observations: { type: 'array', minItems: 1, items: observed }
        }
      }
    }
  }
};

export const validateTarget = ajv.compile(targetSchema);
export const validateCase = ajv.compile(caseSchema);

export function explainSchemaErrors(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}
