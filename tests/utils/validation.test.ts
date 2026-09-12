// Covers the input guards: path traversal, chat ID shapes, account names and
// per-command argument requirements. These sit directly on user input, so a
// regression here is a security problem rather than a cosmetic one.
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import {
  validatePath,
  validateChatId,
  validateAccountName,
  validateCommand,
  resolveCommandAlias,
  sanitizeInput,
  VALID_COMMANDS,
} from '../../src/utils/validation.js';
import type { CommandOptions } from '../../src/types/index.js';

describe('validatePath', () => {
  const base = '/tmp/tgmanager-base';

  it('resolves a relative path inside the base directory', () => {
    expect(validatePath('file.bin', base)).toBe(resolve(base, 'file.bin'));
  });

  it('allows nested paths inside the base directory', () => {
    expect(validatePath('nested/dir/file.bin', base)).toBe(resolve(base, 'nested/dir/file.bin'));
  });

  it('rejects traversal above the base directory', () => {
    expect(() => validatePath('../../etc/passwd', base)).toThrow(/Access denied/);
  });

  it('rejects an absolute path outside the base directory', () => {
    expect(() => validatePath('/etc/passwd', base)).toThrow(/Access denied/);
  });

  it('rejects traversal that re-enters via a sibling directory', () => {
    expect(() => validatePath('../tgmanager-other/file.bin', base)).toThrow(/Access denied/);
  });
});

describe('validateChatId', () => {
  it('accepts "me"', () => {
    expect(validateChatId('me')).toBe('me');
  });

  it('accepts positive and negative numeric IDs', () => {
    expect(validateChatId('123456')).toBe('123456');
    expect(validateChatId('-1001234567890')).toBe('-1001234567890');
  });

  it('accepts a well-formed username', () => {
    expect(validateChatId('@example_channel')).toBe('@example_channel');
  });

  it.each([
    ['@1startswithdigit'],
    ['@_underscore_first'],
    ['@'],
    [`@${'a'.repeat(32)}`],
    ['@has-a-hyphen'],
  ])('rejects malformed username %s', username => {
    expect(() => validateChatId(username)).toThrow(/Invalid username format/);
  });

  it('rejects non-numeric, non-username input', () => {
    expect(() => validateChatId('not-an-id')).toThrow(/Invalid chat ID format/);
  });
});

describe('validateAccountName', () => {
  const available = ['alpha', 'beta'];

  it('accepts a configured account', () => {
    expect(validateAccountName('alpha', available)).toBe('alpha');
  });

  it('requires a name', () => {
    expect(() => validateAccountName('', available)).toThrow(/required/);
  });

  it.each([['../escape'], ['dir/name'], ['back\\slash'], ['nul\0byte']])(
    'rejects path-traversal characters in %j',
    name => {
      expect(() => validateAccountName(name, available)).toThrow(/illegal characters/);
    }
  );

  it('rejects an account that is not configured', () => {
    expect(() => validateAccountName('gamma', available)).toThrow(/Invalid account name/);
  });
});

describe('resolveCommandAlias', () => {
  it.each([
    ['store', 'upload-storage'],
    ['get', 'download-storage'],
    ['ls', 'list-storage'],
  ])('maps %s to %s', (alias, canonical) => {
    expect(resolveCommandAlias(alias)).toBe(canonical);
  });

  it('passes through a non-alias unchanged', () => {
    expect(resolveCommandAlias('upload')).toBe('upload');
  });

  it('resolves every alias to a valid command', () => {
    for (const alias of ['store', 'get', 'ls']) {
      expect(VALID_COMMANDS).toContain(resolveCommandAlias(alias));
    }
  });
});

describe('validateCommand', () => {
  const opts = (o: Partial<CommandOptions> = {}): CommandOptions => o;

  it('rejects an unknown command', () => {
    expect(() => validateCommand('frobnicate', opts())).toThrow(/Invalid command/);
  });

  it('rejects a missing command', () => {
    expect(() => validateCommand(undefined, opts())).toThrow(/Invalid command/);
  });

  it('requires chat ID and file path for upload', () => {
    expect(() => validateCommand('upload', opts({ filePath: '/tmp/a' }))).toThrow(/Chat ID is required/);
    expect(() => validateCommand('upload', opts({ chatId: 'me' }))).toThrow(/File path is required/);
    expect(validateCommand('upload', opts({ chatId: 'me', filePath: '/tmp/a' }))).toBeTruthy();
  });

  it('requires a name of sane length for create', () => {
    expect(() => validateCommand('create', opts())).toThrow(/Name is required/);
    expect(() => validateCommand('create', opts({ name: 'x'.repeat(256) }))).toThrow(/between 1 and 255/);
    expect(validateCommand('create', opts({ name: 'My Channel' }))).toBeTruthy();
  });

  it('requires file and virtual paths for upload-storage', () => {
    expect(() => validateCommand('upload-storage', opts({ virtualPath: 'a/b' }))).toThrow(/File path is required/);
    expect(() => validateCommand('upload-storage', opts({ filePath: '/tmp/a' }))).toThrow(/Virtual path is required/);
  });

  it('requires a virtual path for download-storage', () => {
    expect(() => validateCommand('download-storage', opts())).toThrow(/Virtual path is required/);
  });

  it('accepts list-storage with no extra arguments', () => {
    expect(validateCommand('list-storage', opts())).toBeTruthy();
  });
});

describe('sanitizeInput', () => {
  it('strips control characters', () => {
    expect(sanitizeInput('safe\x00\x1Ftext')).toBe('safetext');
  });

  it('strips DEL', () => {
    expect(sanitizeInput('a\x7Fb')).toBe('ab');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeInput('  padded  ')).toBe('padded');
  });

  it('passes non-string values through untouched', () => {
    expect(sanitizeInput(42)).toBe(42);
    expect(sanitizeInput(null)).toBeNull();
  });
});
