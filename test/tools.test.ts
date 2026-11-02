import { describe, expect, it } from 'vitest';
import { loadSpecIndex } from '../src/spec.js';
import { TOOLS, TOOLSETS } from '../src/tools.js';
import { subscriptionEventTypes, WEBHOOK_EVENT_TYPES } from '../src/webhooks.js';

describe('tool registry', () => {
  const spec = loadSpecIndex();

  it('covers every non-deprecated operation of the bundled spec exactly once', () => {
    const expected = [...spec.operations.values()].filter((op) => !op.deprecated).map((op) => op.operationId).sort();
    const actual = TOOLS.map((t) => t.operationId).sort();
    expect(actual).toEqual(expected);
  });

  it('exposes no deprecated operation', () => {
    for (const tool of TOOLS) expect(spec.operations.get(tool.operationId)?.deprecated, tool.name).toBe(false);
  });

  it('uses unique snake_case names', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('declares every path parameter of the operation', () => {
    for (const tool of TOOLS) {
      const op = spec.operations.get(tool.operationId)!;
      const pathParams = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
      expect([...tool.pathKeys].sort(), tool.name).toEqual(pathParams);
    }
  });

  it('assigns every toolset at least one tool', () => {
    for (const toolset of TOOLSETS) expect(TOOLS.some((t) => t.toolset === toolset), toolset).toBe(true);
  });

  it('knows the payload schema of every webhook event type', () => {
    expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(subscriptionEventTypes().sort());
  });
});
