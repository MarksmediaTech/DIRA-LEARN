import { supabaseConfigProblem } from './supabaseConfig';

describe('production database settings guard', () => {
  it('lets development builds use the local fallback', () => expect(supabaseConfigProblem(undefined, undefined, false)).toBeNull());
  it('stops a production build without settings', () => expect(supabaseConfigProblem(undefined, undefined, true)).toMatch(/without its database settings/));
  it('stops a production build pointing at a local or insecure address', () => {
    expect(supabaseConfigProblem('http://127.0.0.1:54321', 'k', true)).toMatch(/local or insecure/);
    expect(supabaseConfigProblem('https://localhost:54321', 'k', true)).toMatch(/local or insecure/);
    expect(supabaseConfigProblem('http://abc.supabase.co', 'k', true)).toMatch(/local or insecure/);
  });
  it('accepts the hosted Supabase address', () => expect(supabaseConfigProblem('https://abcdefghijklmnop.supabase.co', 'sb_publishable_x', true)).toBeNull());
});
