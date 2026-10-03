import { parseRemoteResource } from '../src/course-evaluation';

describe('Week 05 remote resource contract', () => {
  test('accepts a valid envelope and ignores future envelope fields', () => {
    const input = {
      id: 'campus-inc-001',
      version: 2,
      status: 'assigned',
      payload: { category: 'connectivity' },
      futureField: 'ignored',
    };

    expect(parseRemoteResource(input)).toEqual({
      ok: true,
      value: {
        id: 'campus-inc-001',
        version: 2,
        status: 'assigned',
        payload: { category: 'connectivity' },
      },
    });
  });

  test('keeps a valid null payload distinct from an invalid envelope', () => {
    expect(
      parseRemoteResource({
        id: 'campus-inc-002',
        version: 0,
        status: 'open',
        payload: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        id: 'campus-inc-002',
        version: 0,
        status: 'open',
        payload: null,
      },
    });
  });

  test.each([
    ['non-object envelope', null],
    ['array envelope', []],
    [
      'blank id',
      { id: '   ', version: 1, status: 'open', payload: null },
    ],
    [
      'blank status',
      { id: 'campus-inc-003', version: 1, status: '\t', payload: null },
    ],
    [
      'negative version',
      { id: 'campus-inc-003', version: -1, status: 'open', payload: null },
    ],
    [
      'fractional version',
      { id: 'campus-inc-003', version: 1.5, status: 'open', payload: null },
    ],
    [
      'array payload',
      { id: 'campus-inc-003', version: 1, status: 'open', payload: [] },
    ],
    [
      'missing payload',
      { id: 'campus-inc-003', version: 1, status: 'open' },
    ],
  ])('rejects %s without throwing', (_caseName, input) => {
    expect(parseRemoteResource(input)).toEqual({
      ok: false,
      error: 'contract',
    });
  });

  test('does not mutate the provider object or expose its envelope fields', () => {
    const payload = { category: 'water' };
    const input = Object.freeze({
      id: 'campus-inc-004',
      version: 1,
      status: 'open',
      payload,
      ignored: 'future-value',
    });

    const result = parseRemoteResource(input);

    expect(input).toEqual({
      id: 'campus-inc-004',
      version: 1,
      status: 'open',
      payload,
      ignored: 'future-value',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).not.toBe(payload);
      expect('ignored' in result.value).toBe(false);
    }
  });
});
