import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/schema';

const parse = (type: string, payload: object) => parseClientMessage(JSON.stringify({ type, requestId: 'avatar-test', payload }));

describe('avatar messages', () => {
  it('accepts existing clients joining without an avatar', () => {
    expect(parse('room:join', { name: 'Player' })).toMatchObject({ type: 'room:join', payload: { name: 'Player' } });
  });

  it('accepts a supported avatar on join and update', () => {
    const avatar = { icon: '🦊', color: 'teal' };
    expect(parse('room:join', { name: 'Player', avatar })).toMatchObject({ payload: { avatar } });
    expect(parse('room:avatar', { avatar })).toMatchObject({ type: 'room:avatar', payload: { avatar } });
    expect(parse('room:avatar', { avatar: { icon: 'initials', color: 'red' } })).not.toHaveProperty('error');
  });

  it.each([
    { icon: 'https://example.com/image.png', color: 'teal' },
    { icon: '🦊', color: 'url(example.com)' },
    { icon: '🦊' },
    { icon: '🦊', color: 'teal', extra: 'value' },
    null,
  ])('rejects unsupported or incomplete avatars: %j', (avatar) => {
    expect(parse('room:avatar', { avatar })).toHaveProperty('error');
    expect(parse('room:join', { name: 'Player', avatar })).toHaveProperty('error');
  });
});
